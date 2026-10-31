"""Planet Lab Flask API and small single-process collaboration hub (v0.3.2)."""
import hashlib
import hmac
import json
import os
import secrets
import threading
from datetime import timedelta
import uuid
from pathlib import Path

from flask import g, Flask, abort, jsonify, request, send_from_directory, send_file, session
from flask_sock import Sock
from sqlalchemy import create_engine, or_, select, func
from sqlalchemy.orm import sessionmaker
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from .models import Base, User, World, Message, Media
from .ai_routes import setup_ai

VERSION = '0.4.9'
MAX_PLAN = 2 * 1024 * 1024
MAX_UPLOAD = 50 * 1024 * 1024
ALLOWED_MEDIA = {'.glb', '.gltf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mp3', '.wav', '.ogg'}


def create_app(test_config=None):
    config = dict(test_config or {})
    data_dir = Path(config.get('DATA_DIR', os.environ.get('PLANETLAB_DATA_DIR', '/var/lib/planetlab'))).resolve()
    static_dir = Path(__file__).resolve().parent.parent
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / 'media').mkdir(exist_ok=True)
    db_url = config.get('DATABASE_URL', os.environ.get('PLANETLAB_DATABASE_URL', f'sqlite:///{data_dir / "planetlab.sqlite3"}'))
    app = Flask(__name__, static_folder=None)
    # Only deploy behind local Nginx; Gunicorn binds 127.0.0.1.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    app.secret_key = config.get('SECRET_KEY', os.environ.get('PLANETLAB_SECRET_KEY'))
    if not app.secret_key:
        if config.get('TESTING'):
            app.secret_key = 'test-only-not-a-production-secret'
        else:
            raise RuntimeError('PLANETLAB_SECRET_KEY must be configured (persistent, random).')
    app.config.update(
        TESTING=config.get('TESTING', False),
        MAX_CONTENT_LENGTH=MAX_UPLOAD + 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=not config.get('TESTING', False) and os.environ.get('PLANETLAB_DEV_HTTP', '0') != '1',
        SESSION_COOKIE_SAMESITE='Lax',
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        SESSION_REFRESH_EACH_REQUEST=True,
        SOCK_SERVER_OPTIONS={'ping_interval': 25, 'max_message_size': 8192},
    )
    engine = create_engine(db_url, pool_pre_ping=True, connect_args={'check_same_thread': False} if db_url.startswith('sqlite:') else {})
    if db_url.startswith('sqlite:'):
        from sqlalchemy import event
        @event.listens_for(engine, 'connect')
        def pragmas(connection, _):
            cursor = connection.cursor()
            cursor.execute('PRAGMA journal_mode=WAL')
            cursor.execute('PRAGMA foreign_keys=ON')
            cursor.close()
    Base.metadata.create_all(engine)  # Initial schema bootstrap; future alterations must use Alembic migrations.
    db_session = sessionmaker(engine, expire_on_commit=False)
    app.extensions['planet_db_session'] = db_session
    sock = Sock(app)
    clients = {}  # world_id -> set(ws); one Gunicorn worker for v0.3.0
    clients_lock = threading.RLock()

    def fail(message, status=400):
        return jsonify(error=message), status

    def actor(db):
        uid = session.get('uid')
        return db.get(User, uid) if isinstance(uid, int) else None

    def require_csrf():
        provided = request.headers.get('X-CSRF-Token', '')
        expected = session.get('csrf', '')
        if not expected or not hmac.compare_digest(provided, expected):
            abort(403, description='CSRF token required')
        origin = request.headers.get('Origin')
        if origin and origin.rstrip('/') != request.host_url.rstrip('/'):
            abort(403, description='Unexpected request origin')

    def allowed_world(db, world_id, user):
        world = db.get(World, world_id)
        if world is None or not (world.is_public or user and world.owner_id == user.id):
            abort(404)
        return world

    def public_world(w):
        place = w.blueprint.get('place', {}) if isinstance(w.blueprint, dict) else {}
        config = w.blueprint.get('config', {}) if isinstance(w.blueprint, dict) else {}
        anchor = config.get('anchor') if isinstance(config, dict) else None
        if not isinstance(anchor, dict):
            anchor = None
        else:
            try:
                lat, lon = float(anchor['lat']), float(anchor['lon'])
                anchor = {'lat': lat, 'lon': lon} if -90 <= lat <= 90 and -180 <= lon <= 180 else None
            except (KeyError, ValueError, TypeError):
                anchor = None
        return dict(id=w.id, title=w.title, owner=w.owner.handle, revision=w.revision,
                    is_public=w.is_public, updated_at=w.updated_at.isoformat() if w.updated_at else None,
                    anchor=anchor, seed=str(config.get('seed', ''))[:60] if isinstance(config, dict) else '',
                    starred=bool(place.get('starred')) if isinstance(place, dict) else False,
                    codename=str(place.get('codename', ''))[:60] if isinstance(place, dict) else '')

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        # A new release must never serve cached JS from an older HTML layout.
        # Keep application documents and JavaScript modules uncacheable; use
        # versioned URLs for module entries as a second layer of protection.
        path = request.path.lower()
        uncacheable = (path == '/' or path.endswith(('.html', '.mjs', '.js'))
                       or path.startswith('/api/'))
        response.headers['Cache-Control'] = 'no-store, max-age=0' if uncacheable else 'public, max-age=600'
        # Explicit debug mode, only for authenticated AI requests: append bounded
        # upstream HTTP diagnostics to this response. No server-side history,
        # no credentials, no logs containing user keys.
        if (path.startswith('/api/ai/') and request.headers.get('X-PlanetLab-Debug') == '1'
                and session.get('uid') and response.is_json):
            record = getattr(g, 'planetlab_provider_trace', None)
            if record is not None:
                payload = response.get_json(silent=True)
                if isinstance(payload, dict):
                    payload['_trace'] = record
                    response.set_data(json.dumps(payload, ensure_ascii=False))
        return response

    @app.errorhandler(413)
    def too_large(_):
        return fail('Upload too large (50 MB limit)', 413)

    @app.errorhandler(403)
    def forbidden(_):
        return fail('Forbidden', 403)

    @app.errorhandler(404)
    def notfound(_):
        return fail('Not found', 404)

    @app.get('/api/health')
    def health():
        with db_session() as db:
            db.execute(select(func.count()).select_from(User)).scalar_one()
        return jsonify(service='planetlab-api', version=VERSION, status='ok', database='connected', websocket='enabled')

    @app.get('/api/releases')
    def release_history():
        path = data_dir / 'deployment-history.json'
        if not path.is_file():
            return jsonify(version=VERSION, releases=[])
        try:
            # Public metadata only: deployed version, UTC time, Git commit SHA.
            # Stored outside the web release directory.
            if path.stat().st_size > 64 * 1024:
                return fail('Release history unavailable', 503)
            rows = json.loads(path.read_text()).get('releases', [])
            safe = []
            for item in rows[:25]:
                if not isinstance(item, dict):
                    continue
                safe.append({k: str(item.get(k, ''))[:80] for k in ('version', 'deployedAt', 'git')})
            return jsonify(version=VERSION, releases=safe)
        except (OSError, ValueError, TypeError):
            return fail('Release history unavailable', 503)

    @app.get('/api/session')
    def status():
        session.setdefault('csrf', secrets.token_urlsafe(32))
        with db_session() as db:
            user = actor(db)
            return jsonify(
                user={'id': user.id, 'handle': user.handle} if user else None,
                csrf=session['csrf'],
                is_admin=bool(user and user.handle == os.environ.get('PLANETLAB_ADMIN_HANDLE', '').strip().lower()
                              and str(user.id) == os.environ.get('PLANETLAB_ADMIN_USER_ID', '').strip())
            )

    @app.post('/api/register')
    def register():
        require_csrf()
        body = request.get_json(silent=True) or {}
        handle = str(body.get('handle', '')).strip().lower()
        password = str(body.get('password', ''))
        import re
        if not re.fullmatch(r'[a-z0-9_-]{3,32}', handle) or not (12 <= len(password) <= 200):
            return fail('Handle: 3–32 letters/numbers/_/-; password: at least 12 characters')
        with db_session.begin() as db:
            if db.scalar(select(User).where(User.handle == handle)):
                return fail('Handle already used', 409)
            new_user = User(handle=handle, password_hash=generate_password_hash(password))
            db.add(new_user)
            db.flush()
            uid = new_user.id
        session.clear()
        session.permanent = True
        session['uid'] = uid
        session['csrf'] = secrets.token_urlsafe(32)
        return jsonify(id=uid, handle=handle, csrf=session['csrf']), 201

    @app.post('/api/login')
    def login():
        require_csrf()
        body = request.get_json(silent=True) or {}
        handle = str(body.get('handle', '')).strip().lower()
        with db_session() as db:
            user = db.scalar(select(User).where(User.handle == handle))
            if not user or not check_password_hash(user.password_hash, str(body.get('password', ''))):
                return fail('Invalid credentials', 401)
            uid = user.id
        session.clear()
        session.permanent = True
        session['uid'] = uid
        session['csrf'] = secrets.token_urlsafe(32)
        return jsonify(id=uid, handle=handle, csrf=session['csrf'])

    @app.post('/api/logout')
    def logout():
        require_csrf()
        session.clear()
        session['csrf'] = secrets.token_urlsafe(32)
        return jsonify(ok=True, csrf=session['csrf'])

    @app.get('/api/worlds')
    def list_worlds():
        with db_session() as db:
            user = actor(db)
            query = select(World).where(or_(World.is_public.is_(True), World.owner_id == user.id)) if user else select(World).where(World.is_public.is_(True))
            rows = db.scalars(query.order_by(World.updated_at.desc()).limit(100)).all()
            return jsonify(worlds=[public_world(w) for w in rows])

    @app.post('/api/worlds')
    def create_world():
        require_csrf()
        with db_session.begin() as db:
            user = actor(db)
            if not user:
                return fail('Login required', 401)
            data = request.get_json(silent=True) or {}
            blueprint = data.get('blueprint')
            title = str(data.get('title', 'Unnamed world')).strip()[:100]
            if not isinstance(blueprint, dict) or 'config' not in blueprint or not title or len(json.dumps(blueprint)) > MAX_PLAN:
                return fail('Invalid blueprint or title (max 2 MB)')
            world = World(owner_id=user.id, title=title, blueprint=blueprint, is_public=bool(data.get('is_public', False)))
            db.add(world)
            db.flush()
            world_id = world.id
        return jsonify(id=world_id, revision=1), 201

    @app.get('/api/worlds/<int:world_id>')
    def get_world(world_id):
        with db_session() as db:
            world = allowed_world(db, world_id, actor(db))
            return jsonify(**public_world(world), blueprint=world.blueprint)

    @app.put('/api/worlds/<int:world_id>')
    def update_world(world_id):
        require_csrf()
        with db_session.begin() as db:
            user = actor(db)
            world = db.get(World, world_id)
            if not user or not world or world.owner_id != user.id:
                abort(403)
            data = request.get_json(silent=True) or {}
            if data.get('revision') != world.revision:
                return fail('Revision conflict; reload this world', 409)
            blueprint = data.get('blueprint')
            if not isinstance(blueprint, dict) or 'config' not in blueprint or len(json.dumps(blueprint)) > MAX_PLAN:
                return fail('Invalid blueprint')
            world.blueprint = blueprint
            world.title = str(data.get('title', world.title)).strip()[:100] or world.title
            world.is_public = bool(data.get('is_public', world.is_public))
            world.revision += 1
            db.flush()
            result = world.revision
        broadcast(world_id, {'type': 'world_updated', 'revision': result})
        return jsonify(id=world_id, revision=result)

    @app.patch('/api/worlds/<int:world_id>/star')
    def star_world(world_id):
        require_csrf()
        with db_session.begin() as db:
            user = actor(db)
            world = db.get(World, world_id)
            if not user or not world or world.owner_id != user.id:
                abort(403)
            data = request.get_json(silent=True) or {}
            if not isinstance(data.get('starred'), bool):
                return fail('starred must be true or false')
            if data.get('revision') != world.revision:
                return fail('Revision conflict; refresh snapshots', 409)
            # Reassignment is required for SQLAlchemy JSON change tracking.
            blueprint = dict(world.blueprint)
            place = dict(blueprint.get('place') or {})
            place['starred'] = data['starred']
            blueprint['place'] = place
            world.blueprint = blueprint
            world.revision += 1
            db.flush()
            result = world.revision
        broadcast(world_id, {'type': 'world_updated', 'revision': result})
        return jsonify(id=world_id, revision=result, starred=data['starred'])

    @app.get('/api/worlds/<int:world_id>/messages')
    def get_messages(world_id):
        with db_session() as db:
            allowed_world(db, world_id, actor(db))
            rows = db.scalars(select(Message).where(Message.world_id == world_id).order_by(Message.id.desc()).limit(50)).all()
            return jsonify(messages=[dict(id=m.id, user=m.user.handle, text=m.content) for m in reversed(rows)])

    def broadcast(world_id, data):
        encoded = json.dumps(data)
        with clients_lock:
            participants = tuple(clients.get(world_id, set()))
        for peer in participants:
            try:
                peer.send(encoded)
            except (OSError, RuntimeError):
                with clients_lock:
                    clients.get(world_id, set()).discard(peer)

    @sock.route('/ws/world/<int:world_id>')
    def realtime(ws, world_id):
        origin = request.headers.get('Origin', '')
        if origin.rstrip('/') != request.host_url.rstrip('/'):
            ws.close()
            return
        with db_session() as db:
            user = actor(db)
            if not user:
                ws.close()
                return
            world = db.get(World, world_id)
            if not world or not (world.is_public or world.owner_id == user.id):
                ws.close()
                return
            handle, uid = user.handle, user.id
        with clients_lock:
            clients.setdefault(world_id, set()).add(ws)
            count = len(clients[world_id])
        broadcast(world_id, {'type': 'presence', 'user': handle, 'state': 'joined', 'online': count})
        try:
            while True:
                raw = ws.receive()
                if raw is None:
                    break
                try:
                    message = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                if not isinstance(message, dict):
                    continue
                if message.get('type') == 'chat':
                    value = str(message.get('text', '')).strip()[:1000]
                    if not value:
                        continue
                    with db_session.begin() as db:
                        msg = Message(world_id=world_id, user_id=uid, content=value)
                        db.add(msg)
                        db.flush()
                        mid = msg.id
                    broadcast(world_id, {'type': 'chat', 'id': mid, 'user': handle, 'text': value})
                elif message.get('type') == 'cursor':
                    x, z = message.get('x'), message.get('z')
                    if type(x) in (int, float) and type(z) in (int, float) and -1000 <= x <= 1000 and -1000 <= z <= 1000:
                        broadcast(world_id, {'type': 'cursor', 'user': handle, 'x': x, 'z': z})
        finally:
            with clients_lock:
                clients.get(world_id, set()).discard(ws)
                count = len(clients.get(world_id, set()))
            broadcast(world_id, {'type': 'presence', 'user': handle, 'state': 'left', 'online': count})

    @app.post('/api/worlds/<int:world_id>/media')
    def media_upload(world_id):
        require_csrf()
        with db_session() as db:
            user = actor(db)
            world = db.get(World, world_id)
            if not user or not world or world.owner_id != user.id:
                abort(403)
            uid = user.id
        upload = request.files.get('file')
        if not upload:
            return fail('Missing file')
        name = secure_filename(upload.filename or '')[:220]
        suffix = Path(name).suffix.lower()
        if not name or suffix not in ALLOWED_MEDIA:
            return fail('Unsupported media extension')
        identifier = str(uuid.uuid4())
        destination = data_dir / 'media' / (identifier + suffix)
        digest = hashlib.sha256()
        size = 0
        try:
            with destination.open('xb') as output:
                while chunk := upload.stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD:
                        raise ValueError('File exceeds 50 MB')
                    output.write(chunk)
                    digest.update(chunk)
            if not size:
                raise ValueError('Empty file')
            if suffix == '.glb':
                with destination.open('rb') as stream:
                    header = stream.read(12)
                if len(header) != 12 or header[:4] != b'glTF' or int.from_bytes(header[4:8], 'little') != 2 or int.from_bytes(header[8:12], 'little') != size:
                    raise ValueError('Invalid GLB header')
            with db_session.begin() as db:
                db.add(Media(id=identifier, owner_id=uid, world_id=world_id, filename=name,
                             mime=upload.mimetype or 'application/octet-stream', size=size, sha256=digest.hexdigest()))
        except Exception as exc:
            destination.unlink(missing_ok=True)
            if isinstance(exc, ValueError):
                return fail(str(exc))
            raise
        return jsonify(id=identifier, filename=name, size=size, sha256=digest.hexdigest()), 201

    @app.get('/api/worlds/<int:world_id>/media')
    def list_media(world_id):
        with db_session() as db:
            allowed_world(db, world_id, actor(db))
            rows = db.scalars(select(Media).where(Media.world_id == world_id).order_by(Media.created_at.desc()).limit(100)).all()
            return jsonify(media=[dict(id=m.id, filename=m.filename, size=m.size) for m in rows])

    @app.get('/api/media/<media_id>')
    def download_media(media_id):
        with db_session() as db:
            item = db.get(Media, media_id)
            if not item:
                abort(404)
            allowed_world(db, item.world_id, actor(db))
            file_path = data_dir / 'media' / (item.id + Path(item.filename).suffix.lower())
            if not file_path.is_file():
                abort(404)
            return send_file(file_path, mimetype='application/octet-stream', as_attachment=True, download_name=item.filename)

    @app.get('/api/media/<media_id>/raw')
    def inline_media(media_id):
        with db_session() as db:
            item = db.get(Media, media_id)
            if not item:
                abort(404)
            allowed_world(db, item.world_id, actor(db))
            if Path(item.filename).suffix.lower() not in ('.glb', '.webp', '.png', '.jpg', '.jpeg'):
                abort(404)
            file_path = data_dir / 'media' / (item.id + Path(item.filename).suffix.lower())
            if not file_path.is_file():
                abort(404)
            mimetype = 'model/gltf-binary' if file_path.suffix == '.glb' else item.mime
            return send_file(file_path, mimetype=mimetype, as_attachment=False)

    setup_ai(app, db_session, data_dir, actor, require_csrf, fail)

    @app.get('/')
    def homepage():
        return send_from_directory(static_dir, 'index.html')

    @app.get('/<path:filename>')
    def static_asset(filename):
        if filename.startswith(('.', 'backend/', 'scripts/', 'tests/')) or '/.' in filename:
            abort(404)
        return send_from_directory(static_dir, filename)

    return app
