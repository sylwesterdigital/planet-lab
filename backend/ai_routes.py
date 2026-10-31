"""Optional Meta and Tripo integration routes, installed into the existing Flask app.

No network calls occur during startup, tests or deployment. APIs are invoked by
explicit authenticated actions only. Secret storage lives outside the Git tree.
"""
import base64
import hashlib
import os
import re
import uuid
import urllib.parse
import urllib.request
from pathlib import Path

from flask import abort, jsonify, request, session
from sqlalchemy import select

from .integrations import (IntegrationError, DEFAULTS, public_settings, update, required,
                           provider_request, parse_building, build_prompt, extract_chat_text)
from .models import AssetJob, Media, User, World


class ClientProviderInputError(IntegrationError):
    """Invalid or missing per-request settings; the request must not call a paid provider."""


def setup_ai(app, db_session, data_dir, actor, require_csrf, fail):
    def ai_error(exc, fallback):
        """Keep client setup errors (400) separate from upstream failures (502)."""
        if isinstance(exc, ClientProviderInputError):
            return fail(str(exc), 400)
        return fail(str(exc) if isinstance(exc, IntegrationError) else fallback, 502)

    def admin_user(db):
        user = actor(db)
        handle = os.environ.get('PLANETLAB_ADMIN_HANDLE', '').strip().lower()
        admin_id = os.environ.get('PLANETLAB_ADMIN_USER_ID', '').strip()
        if not handle or not admin_id.isdecimal() or user is None or user.handle != handle or user.id != int(admin_id):
            abort(403)
        return user

    def signed_in(db):
        user = actor(db)
        if user is None:
            abort(401)
        return user

    def provider_for_request(name):
        # Per-request BYOK keys belong to the currently signed-in user. No persistence.
        header_name = 'X-PlanetLab-Meta-Key' if name == 'meta' else 'X-PlanetLab-Tripo-Key'
        key = request.headers.get(header_name, '').strip()
        if key:
            if not (12 <= len(key) <= 4096) or any(ch in key for ch in ('\r', '\n')):
                raise ClientProviderInputError('Invalid provider key')
            return {**DEFAULTS[name], 'api_key': key, 'enabled': True}
        # Backward compatibility: old operator-managed server key stays admin-only.
        uid = session.get('uid')
        with db_session() as db:
            user = actor(db)
            admin_id = os.environ.get('PLANETLAB_ADMIN_USER_ID', '').strip()
            admin_handle = os.environ.get('PLANETLAB_ADMIN_HANDLE', '').strip().lower()
            if user and admin_id.isdecimal() and user.id == int(admin_id) and user.handle == admin_handle:
                return required(data_dir, name)
        raise ClientProviderInputError(f'Open AI Setup and enter your {name} API key.')

    def requested_model(value):
        model = str(value.get('model') or 'muse-spark-1.3').strip()
        if not re.fullmatch(r'muse-[a-z0-9.-]{2,75}', model):
            raise ClientProviderInputError('Invalid Meta model name')
        return model

    def world_owner(db, id):
        user = actor(db)
        world = db.get(World, id)
        if not user or not world or world.owner_id != user.id:
            abort(403)
        return user

    @app.get('/api/integrations')
    def integrations_list():
        with db_session() as db:
            admin_user(db)
        return jsonify(providers=public_settings(data_dir))

    @app.put('/api/integrations/<name>')
    def integrations_update(name):
        require_csrf()
        with db_session() as db:
            admin_user(db)
        try:
            return jsonify(provider=update(data_dir, name, request.get_json(silent=True) or {}))
        except IntegrationError as exc:
            return fail(str(exc))

    @app.post('/api/integrations/<name>/test')
    def integrations_test(name):
        require_csrf()
        with db_session() as db:
            admin_user(db)
        try:
            cfg = required(data_dir, name)
            if name == 'meta':
                result = provider_request(cfg, '/models', timeout=15)
                return jsonify(ok=bool(result.get('data') is not None), provider=name)
            if name == 'tripo':
                # No provider-specific free validation endpoint is guaranteed.
                # Avoid a billed generation just to test a key.
                return jsonify(ok=True, provider=name, status='configured; task generation not attempted')
            return fail('Unknown provider')
        except IntegrationError as exc:
            return fail(str(exc), 502)

    @app.post('/api/ai/connection-test')
    def ai_connection_test():
        require_csrf()
        with db_session() as db:
            signed_in(db)
        payload = request.get_json(silent=True) or {}
        if payload.get('provider') != 'meta':
            return fail('Only Meta connection tests are supported; Tripo is verified on generation.')
        try:
            cfg = provider_for_request('meta')
            model = requested_model(payload)
            # One minimal completion, as documented by Meta. This can incur a small charge.
            result = provider_request(cfg, '/chat/completions', {
                'model': model,
                'messages': [{'role': 'user', 'content': 'Reply with only the word ready'}],
                'max_completion_tokens': 15}, timeout=25)
            reply = str(extract_chat_text(result)).strip()[:80]
            return jsonify(ok=True, model=model, reply=reply)
        except (IntegrationError, KeyError, TypeError, IndexError) as exc:
            return ai_error(exc, 'Unexpected Meta API response')

    @app.post('/api/ai/building')
    def ai_building():
        require_csrf()
        with db_session() as db:
            signed_in(db)
        value = request.get_json(silent=True) or {}
        brief = str(value.get('brief','')).strip()
        if not 4 <= len(brief) <= 1800:
            return fail('Brief must contain 4–1800 characters')
        try:
            settings = provider_for_request('meta')
            model=requested_model(value)
            result = provider_request(settings, '/chat/completions', {
                'model':model,
                'messages':[
                    {'role':'developer', 'content':'You are a building geometry JSON generator. Reply with JSON only.'},
                    {'role':'user','content':build_prompt(brief)}],
                'max_completion_tokens':750}, timeout=65)
            building = parse_building(extract_chat_text(result))
            return jsonify(building=building, model=model,
                           note='Concept geometry only; not engineering or real-estate advice')
        except (IntegrationError, KeyError, IndexError, TypeError) as exc:
            return ai_error(exc, 'Provider response could not be read')

    @app.post('/api/ai/image')
    def ai_image():
        require_csrf()
        body = request.get_json(silent=True) or {}
        prompt = str(body.get('prompt', '')).strip()
        world_id = body.get('world_id')
        if not 4 <= len(prompt) <= 1600 or not isinstance(world_id, int):
            return fail('World ID and a 4–1600 character prompt are required')
        with db_session() as db:
            signed_in(db)
            user = world_owner(db, world_id)
            uid = user.id
        try:
            cfg = provider_for_request('meta')
            data = provider_request(cfg, '/images/generations', {
                'model':cfg['image_model'], 'prompt':prompt, 'n':1,
                'response_format':'b64_json','output_format':'webp'}, timeout=100)
            encoded = data['data'][0]['b64_json']
            if not isinstance(encoded, str) or len(encoded) > 9_000_000:
                raise IntegrationError('Image payload exceeds 6 MB maximum')
            raw = base64.b64decode(encoded, validate=True)
            if len(raw) < 16 or len(raw)>6_000_000 or not raw.startswith(b'RIFF') or raw[8:12]!=b'WEBP':
                raise IntegrationError('Invalid WebP image response')
            mid = str(uuid.uuid4())
            dest = data_dir/'media'/(mid+'.webp')
            with dest.open('xb') as stream:
                stream.write(raw)
            try:
                with db_session.begin() as db:
                    db.add(Media(id=mid, owner_id=uid,world_id=world_id,
                                 filename='muse-concept.webp',mime='image/webp',
                                 size=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
            except Exception:
                dest.unlink(missing_ok=True)
                raise
            return jsonify(media_id=mid, url='/api/media/'+mid+'/raw', size=len(raw))
        except (IntegrationError, KeyError, IndexError, TypeError, ValueError) as exc:
            return ai_error(exc, 'Image generation failed')

    @app.post('/api/ai/tripo')
    def ai_tripo():
        require_csrf()
        body = request.get_json(silent=True) or {}
        prompt = str(body.get('prompt','')).strip()
        world_id=body.get('world_id')
        if not 4 <= len(prompt) <= 1024 or not isinstance(world_id,int):
            return fail('World ID and a 4–1024 character prompt are required')
        with db_session() as db:
            signed_in(db)
            uid=world_owner(db,world_id).id
        try:
            cfg=provider_for_request('tripo')
            response=provider_request(cfg,'/generation/text-to-model',{
                'prompt':prompt,'model':cfg['model']},timeout=35)
            task=response['data']['task_id']
            if not isinstance(task,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}',task):
                raise IntegrationError('Invalid provider task identifier')
            jid=str(uuid.uuid4())
            with db_session.begin() as db:
                db.add(AssetJob(id=jid,user_id=uid,world_id=world_id,
                    external_task_id=task,prompt=prompt,status='queued'))
            return jsonify(job_id=jid,status='queued'),202
        except (IntegrationError,KeyError,TypeError) as exc:
            return ai_error(exc, 'Malformed Tripo response')

    @app.get('/api/ai/tripo/<job_id>')
    def tripo_progress(job_id):
        with db_session() as db:
            user=actor(db)
            job=db.get(AssetJob,job_id)
            if not user or not job or job.user_id!=user.id:
                abort(404)
            task=job.external_task_id
            if job.media_id:
                return jsonify(job_id=job.id,status='imported',media_id=job.media_id)
        try:
            cfg=provider_for_request('tripo')
            response=provider_request(cfg,'/tasks/'+task, timeout=20)
            data=response['data']
            status=str(data.get('status','unknown'))[:32]
            link=(data.get('output') or {}).get('model_url') or ''
            with db_session.begin() as db:
                job=db.get(AssetJob,job_id)
                job.status=status
                if status=='success' and isinstance(link,str):job.result_url=link[:3000]
            return jsonify(job_id=job_id,status=status,
                           progress=data.get('progress',0),
                           can_import=bool(link) and status=='success')
        except (IntegrationError,KeyError,TypeError) as exc:
            return ai_error(exc, 'Tripo status unavailable')

    @app.post('/api/ai/tripo/<job_id>/import')
    def tripo_import(job_id):
        require_csrf()
        with db_session() as db:
            user=actor(db)
            job=db.get(AssetJob,job_id)
            if not user or not job or job.user_id!=user.id:
                abort(404)
            if job.media_id:return jsonify(media_id=job.media_id)
            if job.status!='success' or not job.result_url:return fail('Asset not ready',409)
            url=job.result_url; uid=user.id;world_id=job.world_id
        parsed=urllib.parse.urlsplit(url)
        host=(parsed.hostname or '').lower()
        permitted=['tripo3d.ai','tripo3d.com']
        extra=os.environ.get('PLANETLAB_TRIPO_ASSET_HOSTS','')
        permitted += [h.strip().lower() for h in extra.split(',') if re.fullmatch(r'[a-z0-9.-]+',h.strip().lower())]
        if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443) or not any(host==h or host.endswith('.'+h) for h in permitted):
            return fail('Model CDN host not approved. Configure PLANETLAB_TRIPO_ASSET_HOSTS or download and upload GLB manually.',409)
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):return None
        try:
            opener=urllib.request.build_opener(NoRedirect)
            req=urllib.request.Request(url, headers={'User-Agent':'PlanetLab/0.4'})
            with opener.open(req,timeout=45) as r:
                raw=r.read(50*1024*1024+1)
            if len(raw)<20 or len(raw)>50*1024*1024 or raw[:4]!=b'glTF' or int.from_bytes(raw[4:8],'little')!=2 or int.from_bytes(raw[8:12],'little')!=len(raw):
                return fail('Provider file is not a valid GLB or exceeds 50MB',422)
            mid=str(uuid.uuid4())
            dest=data_dir/'media'/(mid+'.glb')
            with dest.open('xb') as f:f.write(raw)
            try:
                with db_session.begin() as db:
                    job=db.get(AssetJob,job_id)
                    if job.media_id:
                        dest.unlink(missing_ok=True)
                        return jsonify(media_id=job.media_id)
                    db.add(Media(id=mid,owner_id=uid,world_id=world_id,
                                 filename='tripo-'+mid[:8]+'.glb',mime='model/gltf-binary',
                                 size=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
                    job.media_id=mid
            except Exception:
                dest.unlink(missing_ok=True)
                raise
            return jsonify(media_id=mid, url='/api/media/'+mid+'/raw')
        except (OSError, urllib.error.URLError,ValueError) as exc:
            return fail('Model download unavailable or expired; regenerate task and try again',502)
