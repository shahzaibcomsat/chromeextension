import json, pathlib, subprocess
root = pathlib.Path(__file__).resolve().parents[1]
m = json.loads((root / 'manifest.json').read_text())
assert m['manifest_version'] == 3
paths = list(m['icons'].values()) + [m['action']['default_popup'], m['background']['service_worker']]
for script in m.get('content_scripts', []):
    paths += script.get('js', []) + script.get('css', [])
for name in paths:
    assert (root / name).is_file(), name
scripts = list(root.rglob('*.js'))
for script in scripts:
    subprocess.run(['node', '--check', str(script)], check=True, capture_output=True)
print(f'PASS: {len(paths)} manifest resources and {len(scripts)} JavaScript files')
