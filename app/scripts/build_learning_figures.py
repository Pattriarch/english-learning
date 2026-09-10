"""Render the two fixed teaching charts from the same data used by the lesson.

Requires matplotlib (or the ignored data/chart-render-runtime installation).
SVG and its reproducible dataset are portable; PNGs in data are review previews.
"""
import hashlib
import json
from pathlib import Path
import sys
import textwrap

APP = Path(__file__).resolve().parents[1]
runtime = APP/'data/chart-render-runtime'
if runtime.exists():
    sys.path.insert(0, str(runtime))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    plan = json.loads((APP/'content/visual-data-supplement-plan.json').read_text(encoding='utf-8-sig'))
    spec = plan['modules'][0]['visualDataSpec']
    rows = spec['rows']
    for row in rows:
        assert sum(row[k] for k in ('active', 'publicTransport', 'car')) == row['respondents']
        for key in ('active', 'publicTransport', 'car'):
            assert abs(row[key]*100/row['respondents']-row[key+'Percent']) < 1e-8
    figures = spec['figures']
    assert figures[0]['series'][0]['values'] == [r['activePercent'] for r in rows]
    for series in figures[1]['series']:
        row = next(r for r in rows if r['monthKey'] == series['monthKey'])
        assert series['values'] == [row[k] for k in ('activePercent', 'publicTransportPercent', 'carPercent')]
    output = APP/'studio/assets/learning-figures'
    preview = APP/'data/figure-preview'
    output.mkdir(parents=True, exist_ok=True)
    preview.mkdir(parents=True, exist_ok=True)
    dataset = output/'commuting-survey.json'
    dataset.write_text(json.dumps(spec, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 13,
                         'svg.fonttype': 'path', 'svg.hashsalt': 'english-commuting-2026'})
    entries = []
    for index, chart in enumerate(figures):
        fig = plt.figure(figsize=(9, 6.4), facecolor='#fbfcfe')
        ax = fig.add_axes([.13 if index == 0 else .30, .23, .80 if index == 0 else .63, .45])
        ax.set_facecolor('#fbfcfe')
        fig.text(.06, .947, 'READING DATA  /  C1', fontsize=10, weight='bold', color='#4d65a0')
        fig.text(.06, .89, '\n'.join(textwrap.wrap(chart['title'], 52)), fontsize=18, weight='bold',
                 color='#17243c', va='top', linespacing=1.2)
        fig.text(.06, .747, chart['subtitle'], fontsize=11.5, color='#526178')
        for side in ('top', 'right', 'left'):
            ax.spines[side].set_visible(False)
        ax.spines['bottom'].set_color('#9da9bc')
        ax.tick_params(colors='#34445f', length=0, pad=9)
        ax.set_axisbelow(True)
        if index == 0:
            y = chart['series'][0]['values']
            ax.plot(range(len(y)), y, color='#355fcd', lw=3.2, marker='o', markersize=8,
                    markeredgecolor='#fbfcfe', markeredgewidth=1.8)
            ax.set_xticks(range(len(y)), chart['xAxis']['labels'])
            ax.set_xlim(-.18, len(y)-.82)
            ax.set_ylim(chart['yAxis']['min'], chart['yAxis']['max'])
            ax.set_yticks(chart['yAxis']['ticks'])
            ax.yaxis.set_major_formatter(PercentFormatter(100, decimals=0))
            ax.set_ylabel(chart['yAxis']['label'], fontsize=12, color='#34445f', labelpad=10)
            ax.set_xlabel(chart['xAxis']['label'], fontsize=12, color='#34445f', labelpad=12)
            ax.grid(axis='y', color='#dde4ef', lw=.8)
            for x, value in enumerate(y):
                ax.annotate(str(value)+'%', (x, value), xytext=(0, 11), textcoords='offset points',
                            ha='center', color='#253c70', fontsize=13, weight='bold')
            ax.text(.02, .93, chart['series'][0]['label'], transform=ax.transAxes,
                    color='#355fcd', fontsize=12, weight='bold')
        else:
            labels = chart['yAxis']['labels']
            for n, series in enumerate(chart['series']):
                positions = [i + (-.19 if n == 0 else .19) for i in range(len(labels))]
                color = '#456bcc' if n == 0 else '#168579'
                bars = ax.barh(positions, series['values'], height=.30, label=series['label'],
                               color=color, edgecolor='#fbfcfe', linewidth=.5,
                               hatch=None if n == 0 else '///')
                for bar, value in zip(bars, series['values']):
                    ax.text(value+1, bar.get_y()+bar.get_height()/2, str(value)+'%', va='center',
                            color='#22344e', fontsize=12, weight='bold')
            ax.set_yticks(range(len(labels)), labels)
            ax.invert_yaxis()
            ax.set_xlim(chart['xAxis']['min'], chart['xAxis']['max'])
            ax.set_xticks(chart['xAxis']['ticks'])
            ax.xaxis.set_major_formatter(PercentFormatter(100, decimals=0))
            ax.set_xlabel(chart['xAxis']['label'], fontsize=12, color='#34445f', labelpad=12)
            ax.grid(axis='x', color='#dde4ef', lw=.8)
            ax.legend(loc='lower left', bbox_to_anchor=(-.02, 1.015), ncol=2, frameon=False,
                      fontsize=10.5, handlelength=1.5, borderaxespad=0)
        fig.text(.06, .092, '\n'.join(textwrap.wrap(chart['footnote'], 95)), fontsize=10.5,
                 color='#526178', va='top', linespacing=1.45)
        svg = output/(chart['id']+'.svg')
        png = preview/(chart['id']+'.png')
        fig.savefig(svg, format='svg', metadata={'Date': None, 'Creator': 'English teaching chart renderer'})
        fig.savefig(png, dpi=130)
        plt.close(fig)
        entries.append({'id': chart['id'], 'file': svg.name, 'sha256': sha(svg),
                        'datasetFile': dataset.name, 'datasetSHA256': sha(dataset), 'materialId': chart['materialId']})
    # Rebuilding these charts must preserve independently reviewed lesson images.
    manifest_path = output/'manifest.json'
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding='utf-8'))
        if previous.get('version') != 1:
            raise ValueError('Unsupported existing figure manifest')
        owned = {entry['id'] for entry in entries}
        retained = [entry for entry in previous['figures'] if entry['id'] not in owned]
        if len({entry['id'] for entry in retained}) != len(retained):
            raise ValueError('Duplicate unrelated figure entries')
        entries.extend(retained)
    manifest_path.write_text(json.dumps({'version': 1, 'figures': entries}, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'figures': len(entries), 'datasetSHA256': sha(dataset), 'matplotlib': matplotlib.__version__}))


if __name__ == '__main__':
    build()
