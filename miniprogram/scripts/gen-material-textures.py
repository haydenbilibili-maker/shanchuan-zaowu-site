"""
会员卡 / 钱包 / 积分 / 礼券「材质真实化 v2」纹理生成器（2026-10-18，开发工具，不进守卫清单）

产出 SVG 数据 URI，已手工写入：
  components/UserVipCard/index.wxss（黑蟒皮 PYTHON / 白银 SILVER / 黄金 GOLD）
  subpackages/business/components/WalletPanelWallet/wallet-leather.wxss 与 confirm-order/wallet-leather.wxss（鳄鱼皮 CROC，两份一致）
  subpackages/business/components/WalletPanelPoints/index.wxss（黑钛 TITANIUM）
  subpackages/business/components/WalletPanelCoupons/index.wxss（纸纤维 FIBER）
全部固定随机种子，重跑结果逐字节一致；改参数重生成后替换对应 url(...)，并按 check:a-flow-polish R16-1 提示更新指纹。
约束（R39-1）：不得使用 SVG 滤镜（feTurbulence 等真机不稳），单张 ≤8KB。
用法：python3 miniprogram/scripts/gen-material-textures.py <输出目录>
"""
import random, urllib.parse, pathlib
import sys
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT.mkdir(parents=True, exist_ok=True)

def uri(svg):
    svg = ' '.join(svg.split())
    enc = svg.replace('%', '%25').replace('#', '%23').replace('<', '%3C').replace('>', '%3E').replace('"', "'")
    return f'url("data:image/svg+xml,{enc}")'

# —— 鳄鱼皮：120×96 一砖块，两行错缝方鳞，每片中心鼓起（径向渐变），鳞缝深陷 ——
def croc():
    """128×120 一块：三行不同高度、宽度随机的错缝方鳞（固定种子）；压暗、弱高光 —— 第一版太大太亮像键盘"""
    rnd = random.Random(3)
    g = ("<defs><radialGradient id='s' cx='42%' cy='36%' r='80%'>"
         "<stop offset='0' stop-color='#3E2D20'/><stop offset='.6' stop-color='#24190F'/><stop offset='1' stop-color='#110B07'/></radialGradient>"
         "<linearGradient id='h' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#F0D8B0' stop-opacity='.12'/><stop offset='.6' stop-color='#F0D8B0' stop-opacity='0'/></linearGradient></defs>")
    rows, y = [], 1.5
    for h in (42, 34, 40):
        rows.append((y, h)); y += h + 2.5
    total = y
    body = ''
    for ri, (ry, h) in enumerate(rows):
        x = -rnd.uniform(4, 18) if ri % 2 else 1.5
        while x < 128:
            w = rnd.uniform(22, 38)
            for dx in (0, -128, 128):
                body += (f"<rect x='{x+dx:.1f}' y='{ry:.1f}' width='{w:.1f}' height='{h}' rx='{rnd.uniform(6,9):.1f}' fill='url(#s)'/>"
                         f"<rect x='{x+dx+3:.1f}' y='{ry+2:.1f}' width='{w-6:.1f}' height='{h*0.42:.1f}' rx='5' fill='url(#h)'/>")
            x += w + 2.5
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='128' height='{total-0.5:.0f}' viewBox='0 0 128 {total-0.5:.0f}'>{g}<rect width='128' height='{total:.0f}' fill='#0C0805'/>{body}</svg>"
    return uri(svg)

# —— 黑蟒皮：40×28 菱鳞（中心 + 四角），下缘受光、上缘入影；描边 = 鳞缝 ——
def python():
    g = ("<defs><radialGradient id='p' cx='50%' cy='70%' r='62%'>"
         "<stop offset='0' stop-color='#3B332A'/><stop offset='.55' stop-color='#1D1814'/><stop offset='1' stop-color='#0B0907'/></radialGradient></defs>")
    def dia(cx, cy):
        return (f"<path d='M{cx} {cy-13} L{cx+19} {cy} L{cx} {cy+13} L{cx-19} {cy} Z' fill='url(#p)' stroke='#050403' stroke-width='1.3' stroke-linejoin='round'/>"
                f"<path d='M{cx-12} {cy+4} Q{cx} {cy+11} {cx+12} {cy+4}' fill='none' stroke='#E8D2A8' stroke-opacity='.12' stroke-width='.8'/>")
    body = ''.join(dia(x, y) for x, y in [(20, 14), (0, 0), (40, 0), (0, 28), (40, 28)])
    return uri(f"<svg xmlns='http://www.w3.org/2000/svg' width='40' height='28' viewBox='0 0 40 28'>{g}<rect width='40' height='28' fill='#070605'/>{body}</svg>")

# —— 拉丝：2×160 竖向一条，160 道横丝，每道明暗随机（固定种子，构建可复现） ——
def brushed(seed, light, dark):
    """160 道横丝按明暗分 7 档合并成 7 条 path（体积 ≈1KB；逐行 rect 要 10KB，主包吃不起）"""
    rnd = random.Random(seed)
    buckets = {('L', i): [] for i in range(4)}
    buckets.update({('D', i): [] for i in range(3)})
    for y in range(160):
        a = rnd.random()
        if a < 0.45:
            buckets[('L', rnd.randrange(4))].append(y)
        elif a < 0.8:
            buckets[('D', rnd.randrange(3))].append(y)
    op = {('L', 0): .04, ('L', 1): .07, ('L', 2): .1, ('L', 3): .15, ('D', 0): .035, ('D', 1): .06, ('D', 2): .1}
    paths = ''.join(
        f"<path d='{''.join(f'M0 {y}.5h2' for y in ys)}' stroke='{light if k[0] == 'L' else dark}' stroke-opacity='{op[k]}'/>"
        for k, ys in buckets.items() if ys)
    return uri(f"<svg xmlns='http://www.w3.org/2000/svg' width='2' height='160' viewBox='0 0 2 160' preserveAspectRatio='none'><g stroke-width='1'>{paths}</g></svg>")

# —— 纸纤维：80×80 随机短纤维（礼券存根） ——
def fiber(seed):
    rnd = random.Random(seed)
    paths = []
    for _ in range(46):
        x, y = rnd.uniform(0, 80), rnd.uniform(0, 80)
        l = rnd.uniform(3, 9); dx = rnd.uniform(-1, 1) * l; dy = rnd.uniform(-0.35, 0.35) * l
        paths.append(f"<path d='M{x:.1f} {y:.1f} q{dx/2:.1f} {dy/2 + rnd.uniform(-1,1):.1f} {dx:.1f} {dy:.1f}' stroke-opacity='{rnd.uniform(.06,.16):.2f}'/>")
    return uri(f"<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><g stroke='#6B5A3C' stroke-width='.5' fill='none' stroke-linecap='round'>{''.join(paths)}</g></svg>")

T = {
    'CROC': croc(),
    'PYTHON': python(),
    'SILVER': brushed(5, '#FFFFFF', '#1A2028'),
    'GOLD': brushed(6, '#FFF6D6', '#6A4A10'),
    'TITANIUM': brushed(7, '#E8D6AE', '#000000'),
    'FIBER': fiber(9),
}
for k, v in T.items():
    (OUT / f'{k}.txt').write_text(v)
    print(k, len(v))
