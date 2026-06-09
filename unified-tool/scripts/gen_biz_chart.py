#!/usr/bin/env python3
"""
商机储备/纳管率横向柱状图生成器

使用方式:
  python gen_biz_chart.py --data data.json --output out.png [--date "5月10日"] [--title-prefix "商业各分局"] [--subtitle "有效商机 / 商机储备目标"]

data.json 格式:
[
  {"name": "西信商客分局（6）", "amount": 45.69, "target": 2019, "count": 8},
  ...
]

参数说明:
  --data         数据JSON文件路径 (必填)
  --output       输出PNG文件路径 (必填)
  --date         截止日期，如 "5月10日" (默认 "5月14日")
  --title-prefix 标题前缀，如 "商业各分局"、"行业各分局" (默认 "商业各分局")
  --title-suffix 标题后缀，如 "有效商机纳管情况"、"商机储备情况" (默认 "有效商机纳管情况")
  --subtitle     副标题中间文字 (默认 "有效商机 / 商机储备目标")
  --xlabel       X轴标签 (默认 "有效商机完成率")
  --target-line  考核线百分比，可多次指定 (默认 30)
"""
import argparse
import json
import sys

import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib import rcParams
import matplotlib.font_manager as fm
import numpy as np

# 强制重建字体缓存（解决Docker容器首次运行找不到字体的问题）
fm._load_fontmanager(try_read_cache=False)

rcParams['font.sans-serif'] = ['Microsoft YaHei', 'WenQuanYi Zen Hei', 'Noto Sans CJK SC', 'SimHei', 'SimSun', 'DejaVu Sans']
rcParams['axes.unicode_minus'] = False


def build_short_label(name):
    return name.replace('商客分局', '分局').replace('智改数转服务局', '').replace('政企分局', '分局')


def get_color(ratio):
    if ratio >= 30:
        return '#E8383D'
    elif ratio >= 10:
        return '#F5A623'
    else:
        return '#4CAF50'


def main():
    parser = argparse.ArgumentParser(description='商机储备/纳管率横向柱状图生成器')
    parser.add_argument('--data', required=True, help='数据JSON文件路径')
    parser.add_argument('--output', required=True, help='输出PNG文件路径')
    parser.add_argument('--date', default='5月14日', help='截止日期')
    parser.add_argument('--title-prefix', default='商业各分局', help='标题前缀')
    parser.add_argument('--title-suffix', default='有效商机纳管情况', help='标题后缀')
    parser.add_argument('--subtitle', default='有效商机 / 商机储备目标', help='副标题文字')
    parser.add_argument('--xlabel', default='有效商机完成率', help='X轴标签')
    parser.add_argument('--target-line', type=float, action='append', default=[], help='考核线百分比(可多次)')
    parser.add_argument('--year', default='2026', help='年份(4位)')
    args = parser.parse_args()

    if not args.target_line:
        args.target_line = [30]

    with open(args.data, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    df = pd.DataFrame(raw)
    df['ratio'] = df['amount'] / df['target'] * 100
    df = df.sort_values('ratio', ascending=True).reset_index(drop=True)
    colors = [get_color(r) for r in df['ratio']]

    fig, ax = plt.subplots(figsize=(16, 9))
    fig.patch.set_facecolor('#F5F5F5')
    ax.set_facecolor('#FFFFFF')

    y_pos = np.arange(len(df))
    ax.barh(y_pos, df['ratio'], color=colors, height=0.75, edgecolor='none', zorder=3)

    short_labels = [build_short_label(n) for n in df['name']]
    ax.set_yticks(y_pos)
    ax.set_yticklabels(short_labels, fontsize=11)

    # Target lines
    line_styles = [
        {'color': '#F5A623', 'label': '30%考核线', 'bg': '#FFF8E1'},
        {'color': '#E8383D', 'label': '50%考核线', 'bg': '#FFF0F0'},
    ]
    for idx, pct in enumerate(sorted(args.target_line)):
        style = line_styles[idx % len(line_styles)]
        ax.axvline(x=pct, color=style['color'], linestyle='--', linewidth=2.5, zorder=5)
        ax.text(pct, len(df) - 0.3, f'{int(pct)}%考核线', va='bottom', ha='center', fontsize=10,
                fontweight='bold', color=style['color'],
                bbox=dict(boxstyle='round,pad=0.2', facecolor=style['bg'], edgecolor=style['color'], alpha=0.9))

    # Bar labels
    max_rate = df['ratio'].max()
    for i, row in df.iterrows():
        ratio, amount, target = row['ratio'], row['amount'], row['target']
        count = row.get('count', None)
        x_pos = ratio + max_rate * 0.015
        # Rate + count
        rate_text = f'{ratio:.2f}%'
        if count is not None and count > 0:
            rate_text += f'  ({int(count)}个)'
        ax.text(x_pos, i + 0.05, rate_text, va='center', ha='left', fontsize=10, fontweight='bold', color='#333333')
        # Amount/target
        amt_text = f'{amount:.1f}/{target:.0f}万'
        if ratio > 8:
            ax.text(ratio - max_rate * 0.008, i, amt_text, va='center', ha='right', fontsize=8.5, color='white', fontweight='bold')
        else:
            ax.text(x_pos + max_rate * 0.005, i - 0.2, amt_text, va='center', ha='left', fontsize=8, color='#888888')

    ax.set_xlabel(args.xlabel, fontsize=12, fontweight='bold', labelpad=10)
    ax.set_xlim(0, max_rate * 1.22)
    ax.xaxis.grid(True, linestyle='-', alpha=0.15, color='#CCCCCC', zorder=0)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#DDDDDD')
    ax.spines['bottom'].set_color('#DDDDDD')

    for i in range(len(df)):
        if i % 2 == 0:
            ax.axhspan(i - 0.5, i + 0.5, color='#FAFAFA', zorder=1)

    title = f'{args.title_prefix}——{args.year}年{args.title_suffix}'
    subtitle = f'{args.subtitle}  |  截至{args.date}'
    fig.suptitle(title, fontsize=20, fontweight='bold', color='#E8383D', y=0.97)
    ax.set_title(subtitle, fontsize=11, color='#666666', pad=12)

    plt.tight_layout(rect=[0, 0, 1, 0.92])
    fig.savefig(args.output, dpi=180, bbox_inches='tight', facecolor=fig.get_facecolor())
    plt.close()
    print(f'Chart saved to: {args.output}')


if __name__ == '__main__':
    main()
