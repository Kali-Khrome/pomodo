import itertools

_ids = itertools.count(1)
OPTIONS = [{'id': 't', 'name': 'Not started'}, {'id': 'p', 'name': 'In progress'}, {'id': 'c', 'name': 'Done'}]
GROUPS = [
    {'name': 'To-do', 'option_ids': ['t']},
    {'name': 'In progress', 'option_ids': ['p']},
    {'name': 'Complete', 'option_ids': ['c']},
]
DBS = {
    'demo-tasks': {
        'object': 'database', 'id': 'demo-tasks', 'title': [{'plain_text': 'Demo Tasks'}],
        'properties': {
            'Name': {'id': 'title', 'name': 'Name', 'type': 'title', 'title': {}},
            'Status': {'id': 's', 'name': 'Status', 'type': 'status', 'status': {'options': OPTIONS, 'groups': GROUPS}},
            'Pomodoros': {'id': 'n', 'name': 'Pomodoros', 'type': 'number', 'number': {}},
        },
    },
    'demo-reading': {
        'object': 'database', 'id': 'demo-reading', 'title': [{'plain_text': 'Reading List'}],
        'properties': {
            'Title': {'id': 'title', 'name': 'Title', 'type': 'title', 'title': {}},
            'Read': {'id': 'r', 'name': 'Read', 'type': 'checkbox', 'checkbox': {}},
        },
    },
}


def page(db, title, **props):
    t = 'Name' if db == 'demo-tasks' else 'Title'
    p = {'object': 'page', 'id': f'demo-{next(_ids)}', 'url': '#', 'db': db,
         'properties': {t: {'type': 'title', 'title': [{'plain_text': title}]}}}
    if db == 'demo-tasks':
        p['properties']['Status'] = {'type': 'status', 'status': {'name': props.get('status', 'Not started')}}
        p['properties']['Pomodoros'] = {'type': 'number', 'number': props.get('count', 0)}
    else:
        p['properties']['Read'] = {'type': 'checkbox', 'checkbox': False}
    return p


PAGES = [
    page('demo-tasks', 'Draft the Q4 roadmap', status='In progress', count=3),
    page('demo-tasks', 'Reply to studio feedback', count=1),
    page('demo-tasks', 'Sketch onboarding flow', count=2),
    page('demo-tasks', 'Review pull requests'),
    page('demo-tasks', 'Read: Less but Better'),
    page('demo-tasks', 'Plan next sprint'),
    page('demo-reading', 'Less but Better'),
    page('demo-reading', 'Grid Systems in Graphic Design'),
    page('demo-reading', 'The Design of Everyday Things'),
]


def is_done(p):
    pr = p['properties']
    return pr.get('Status', {}).get('status', {}).get('name') == 'Done' or pr.get('Read', {}).get('checkbox')


def mock(method, path, body):
    parts = path.split('/')
    if path == '/v1/search':
        return 200, {'results': list(DBS.values()), 'has_more': False}
    if path.endswith('/query'):
        return 200, {'results': [p for p in PAGES if p['db'] == parts[3] and not is_done(p)], 'has_more': False}
    if path.startswith('/v1/databases/'):
        return (200, DBS[parts[3]]) if parts[3] in DBS else (404, {'message': 'Not found'})
    if method == 'POST' and path == '/v1/pages':
        db = body['parent']['database_id']
        title = next(iter(body['properties'].values()))['title'][0]['text']['content']
        PAGES.append(page(db, title))
        return 200, PAGES[-1]
    p = next((x for x in PAGES if x['id'] == parts[-1]), None)
    if not p:
        return 404, {'message': 'Not found'}
    for k, v in body.get('properties', {}).items():
        p['properties'].setdefault(k, {}).update(v)
    return 200, p
