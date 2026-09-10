"""Apply the reviewed navigation/audio corrections after the full 37-module build.

No provider calls. The original release must match every lesson before any write.
The separate transfer recording keeps its existing text; source page data is not used.
"""
from copy import deepcopy
import json
from pathlib import Path
from build_extended_course import APP, VERSION, atomic_json, digest, stamp, validate, validate_plan
from finalize_extended_course import finalize

MIGRATION = '2026-09-10-separate-transfer-audio-and-related-links'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def refine():
    plan_path = APP/'content/extended-course-plan.json'
    course_path = APP/'content/courses/extended-skills.json'
    log_path = APP/'content/extended-course-migrations.json'
    plan, lessons = read(plan_path), read(course_path)
    log = read(log_path) if log_path.exists() else {'version': 1, 'migrations': []}
    if any(m['id'] == MIGRATION for m in log['migrations']):
        return finalize()
    status = read(APP/'data/extended-build-status.json')
    release = read(APP/'content/extended-course-release.json')
    by_id = {l['id']: l for l in lessons}
    modules = {m['id']: m for m in plan['modules']}
    if status['state'] != 'complete' or release['state'] != 'complete' or len(modules) != 37:
        raise ValueError('Finish and publish all 37 modules before this refinement')
    if set(by_id) != set(modules) or {r['id'] for r in release['modules']} != set(modules):
        raise ValueError('Release/course/plan mismatch')
    for row in release['modules']:
        lesson, module = by_id[row['id']], modules[row['id']]
        validate(lesson, module)
        if digest(lesson) != row['lessonSHA256'] or lesson['provenance']['specHash'] != digest(module):
            raise ValueError('Release changed before reviewed refinement: '+row['id'])
        if lesson['provenance']['promptVersion'] != VERSION:
            raise ValueError('Unexpected authoring version')
    before_plan = deepcopy(plan)
    before_lessons = deepcopy(by_id)
    corrections_path = APP/'content/extended-course-corrections.json'
    corrections = read(corrections_path)
    new_corrections = {}

    def change(lesson_id, path, after, reason):
        lesson = by_id[lesson_id]
        target = lesson
        for key in path[:-1]:
            target = target[key]
        before = deepcopy(target[path[-1]])
        if before == after:
            raise ValueError('Reviewed change already present without migration log')
        target[path[-1]] = deepcopy(after)
        row = new_corrections.setdefault(lesson_id, {'lessonId': lesson_id, 'reason': reason, 'changes': []})
        row['changes'].append({'path': path, 'before': before, 'after': deepcopy(after)})

    registration = by_id['extended-a1-registration']
    body = registration['sections'][0]['body']
    old = 'В этом уроке m1 — авторский сценарий для локального синтеза речи. Готовый аудиофайл в JSON не вложен.'
    if body.count(old) != 1:
        raise ValueError('Registration teaching paragraph changed')
    change(registration['id'], ['sections', 0, 'body'], body.replace(old,
        'В этом уроке m1 — авторский сценарий, озвученный синтезированным английским голосом. Запись доступна в плеере материала.'),
        'Объяснение описывает доступный учебный плеер; техническая фраза о JSON убрана.')

    lesson = by_id['extended-b1-listening']
    module = modules[lesson['id']]
    old_materials = deepcopy(lesson['materials'])
    nina = old_materials[1]['text'].split('Nina: ', 1)[1]
    check_sheet = ('Original teaching material.\n\n'
        'Check sheet: What did I hear? What is my hypothesis? Replay the short passage, '
        'then check the transcript. Record the evidence and explain the mismatch: word '
        'boundary, negative, cause, or correction. Record a useful playback position '
        'if you need to find the passage again. If your first answer was correct, '
        'identify the words you checked instead of inventing a mistake. Keep facts '
        'from each speaker separate.')
    new_materials = deepcopy(old_materials)
    new_materials[1]['text'] = check_sheet
    new_materials.append({'id': 'm4', 'title': 'Другая история / Nina’s move',
        'kind': 'listening', 'text': 'Original teaching monologue. Fictional speaker: Nina.\n\nNina: '+nina,
        'source': 'Авторский учебный материал; ситуация вымышленная'})
    reason = 'Сценарий Нины выделен из открытого справочного листа в отдельную запись m4 только для e8; исправлены сведения о плеере и числе голосов.'
    change(lesson['id'], ['materials'], new_materials, reason)
    body = lesson['sections'][0]['body']
    old = 'Материал m1 — авторский сценарий для локально синтезированной речи двумя голосами. Это не аутентичная запись. В данном JSON звуковой файл отсутствует.'
    if body.count(old) != 1:
        raise ValueError('Listening player paragraph changed')
    change(lesson['id'], ['sections', 0, 'body'], body.replace(old,
        'Материал m1 — авторский диалог двух персонажей, озвученный синтезированным английским голосом. Роли собеседников указаны в тексте; разные персонажи здесь не означают разные голоса. Запись доступна в плеере материала.'), reason)
    body = lesson['sections'][4]['body']
    old = 'на другой короткий материал из закрытой части m2. При доступной озвучке это должна быть отдельная запись.'
    if body.count(old) != 1:
        raise ValueError('Transfer theory paragraph changed')
    change(lesson['id'], ['sections', 4, 'body'], body.replace(old,
        'на отдельную короткую запись m4. Она становится доступна только в e8; во время первого прослушивания держите её текст закрытым.'), reason)
    prompt = lesson['exercises'][7]['prompt']
    old = 'затем впервые откройте короткий сценарий переноса в конце m2. При доступной озвучке прослушайте его как отдельную новую запись, закрыв текст; иначе обозначьте текстовую альтернативу.'
    if prompt.count(old) != 1:
        raise ValueError('Transfer prompt changed')
    change(lesson['id'], ['exercises', 7, 'prompt'], prompt.replace(old,
        'затем выберите отдельный материал m4. Прослушайте короткую новую историю, оставив текст закрытым. Если воспроизведение недоступно, прочитайте m4 и обозначьте текстовую альтернативу.'), reason)
    change(lesson['id'], ['exercises', 7, 'materialIds'], ['m1', 'm2', 'm3', 'm4'], reason)
    change(lesson['id'], ['exercises', 7, 'context'],
        'Вы устраняете ошибки, которые могли бы повлиять на выводы читателя, а затем проверяете тот же навык на другом коротком авторском материале. Отдельная синтезированная запись Нины находится в m4, доступном в этом упражнении.', reason)
    module['materials'][0]['brief'] = module['materials'][0]['brief'].replace('интервью двух голосов', 'интервью двух персонажей, озвучиваемое доступным английским голосом,')
    module['materials'][1]['brief'] += ' Только рабочий лист; сценарий позднего переноса находится отдельно в m4.'
    module['materials'].append({'id': 'm4', 'title': 'Другая история: Нина', 'kind': 'listening',
        'minWords': 35, 'maxWords': 60,
        'brief': 'Самостоятельная короткая вымышленная история для позднего переноса e8: причина смены работы, самокоррекция, условие и неизвестная деталь. Только e8, отдельный аудиофайл; не включать в m2.'})
    module['exercisePlan'][7]['materialIds'].append('m4')

    bridge_path = APP/'content/external-topic-bridge-plan.json'
    bridge = read(bridge_path)
    replacements = {'path-idioms-in-context': 'path-idioms-context',
        'book-vocabulary-upper-023': 'book-vocabulary-upper-intermediate-023',
        'book-vocabulary-upper-025': 'book-vocabulary-upper-intermediate-025'}
    navigation = []
    for collection in [plan['modules'], bridge['modules']]:
        for m in collection:
            ids = m.get('relatedLessonIds', [])
            fixed = [replacements.get(i, i) for i in ids]
            if fixed != ids:
                navigation.append({'id': m['id'], 'before': ids, 'after': fixed})
                m['relatedLessonIds'] = fixed

    validate_plan(plan)
    specs = []
    for module in plan['modules']:
        lesson = by_id[module['id']]
        old_spec = next(m for m in before_plan['modules'] if m['id'] == module['id'])
        if module != old_spec:
            lesson['provenance']['specHash'] = digest(module)
            lesson['provenance']['relatedLessonIds'] = module.get('relatedLessonIds', [])
            lesson['provenance'].setdefault('editorialMigrations', []).append(MIGRATION)
            specs.append({'id': module['id'], 'before': digest(old_spec), 'after': digest(module)})
        if lesson['id'] in new_corrections:
            note = new_corrections[lesson['id']]['reason']
            lesson['provenance'].setdefault('editorialCorrections', []).append(note)
        validate(lesson, module)
    corrections['corrections'].extend(new_corrections.values())
    log['migrations'].append({'id': MIGRATION, 'at': stamp(), 'navigation': navigation,
        'specs': specs, 'materialCountBefore': 124, 'materialCountAfter': 125,
        'lessonChanges': [{'id': i, 'before': digest(before_lessons[i]), 'after': digest(l)}
                          for i, l in by_id.items() if l != before_lessons[i]]})
    # All source identities, bounds and exact before-values passed before writes.
    atomic_json(corrections_path, corrections)
    atomic_json(bridge_path, bridge)
    atomic_json(plan_path, plan)
    atomic_json(course_path, lessons)
    for lesson in lessons:
        atomic_json(APP/'data/extended-lessons'/f"{lesson['id']}.json", lesson)
    atomic_json(log_path, log)
    return finalize()


if __name__ == '__main__':
    result = refine()
    print(json.dumps({k: v for k, v in result.items() if k not in ['modules', 'sourceIds']}, ensure_ascii=False))
