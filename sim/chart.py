"""Draw the four RESULTS charts from sim/out/summary.json. Monochrome, no chart junk."""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

INK = "#0B0B0C"
MUTED = "#71717A"
RULE = "#E4E4E7"
FILLS = ["#0B0B0C", "#3F3F46", "#71717A", "#A1A1AA", "#D4D4D8"]
STYLES = ["solid", "dashed", "dashdot", "dotted", (0, (1, 1))]
SHOCKS = ["baseline", "gating", "default", "depeg", "bank-run"]
STAGES = ["stage1", "stage2", "stage3"]


def usd(micro: float) -> float:
    return micro / 1_000_000


def style(ax) -> None:
    ax.set_facecolor("white")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(RULE)
    ax.spines["bottom"].set_color(RULE)
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.yaxis.grid(True, color=RULE, linewidth=0.6)
    ax.set_axisbelow(True)
    ax.title.set_color(INK)


def save(fig, path: Path) -> None:
    fig.tight_layout()
    fig.savefig(path, dpi=140, facecolor="white")
    plt.close(fig)


def illustrated(runs, stage, shock):
    return next(r for r in runs if r["seed"] == runs[0]["illustrated"] and r["stage"] == stage and r["scenario"] == shock)


def main() -> None:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    data = json.loads(src.read_text())
    runs = data["runs"]
    seed = data["illustratedSeed"]
    for run in runs:
        run["illustrated"] = seed
    runs[0]["illustrated"] = seed

    fig, ax = plt.subplots(figsize=(10, 5.2))
    for shock, color, ls in zip(SHOCKS, FILLS, STYLES):
        path = next(r["path"] for r in runs if r["seed"] == seed and r["stage"] == "stage1" and r["scenario"] == shock)
        ax.plot([p["day"] for p in path], [p["utilBps"] / 100 for p in path], color=color, linestyle=ls, linewidth=1.6, label=shock)
    ax.set_title("Stage 1 utilization, illustrated seed")
    ax.set_xlabel("Day", color=MUTED)
    ax.set_ylabel("Utilization %", color=MUTED)
    ax.set_ylim(0, 105)
    ax.legend(frameon=False, fontsize=8)
    style(ax)
    save(fig, out / "utilization.png")

    fig, ax = plt.subplots(figsize=(10, 5.2))
    for shock, color, ls in zip(SHOCKS, FILLS, STYLES):
        path = next(r["path"] for r in runs if r["seed"] == seed and r["stage"] == "stage1" and r["scenario"] == shock)
        ax.plot([p["day"] for p in path], [usd(p["cumLoss"]) for p in path], color=color, linestyle=ls, linewidth=1.6, label=shock)
    ax.set_title("Stage 1 cumulative credit loss, illustrated seed")
    ax.set_xlabel("Day", color=MUTED)
    ax.set_ylabel("USDG", color=MUTED)
    ax.legend(frameon=False, fontsize=8)
    style(ax)
    save(fig, out / "losses.png")

    fig, ax = plt.subplots(figsize=(10, 5.2))
    import statistics
    width = 0.24
    for i, stage in enumerate(STAGES):
        heights = []
        for shock in SHOCKS:
            group = [r["feeYieldBps"] or 0 for r in runs if r["stage"] == stage and r["scenario"] == shock]
            heights.append(statistics.median(group) / 100)
        xs = [n + (i - 1) * width for n in range(len(SHOCKS))]
        ax.bar(xs, heights, width=width, color=FILLS[i], label=stage)
    ax.set_xticks(range(len(SHOCKS)), SHOCKS)
    ax.set_title("Median gross exit-fee yield on average equity")
    ax.set_ylabel("Percent of average equity", color=MUTED)
    ax.legend(frameon=False, fontsize=8)
    style(ax)
    save(fig, out / "yield.png")

    fig, ax = plt.subplots(figsize=(8.5, 5.2))
    parts = ["reserveAbsorbed", "juniorLoss", "creditLossEquity", "seniorLoss"]
    labels = ["reserve", "junior", "equity", "senior"]
    colors = ["#D4D4D8", "#A1A1AA", "#3F3F46", "#0B0B0C"]
    bottoms = [0, 0, 0]
    for part, label, color in zip(parts, labels, colors):
        vals = []
        for stage in STAGES:
            run = next(r for r in runs if r["seed"] == seed and r["stage"] == stage and r["scenario"] == "bank-run")
            vals.append(usd(run[part]))
        ax.bar(STAGES, vals, bottom=bottoms, color=color, label=label, width=0.62)
        bottoms = [b + v for b, v in zip(bottoms, vals)]
    ax.set_title("Bank-run loss allocation, illustrated seed")
    ax.set_ylabel("USDG", color=MUTED)
    ax.legend(frameon=False, fontsize=8)
    style(ax)
    save(fig, out / "allocation.png")


if __name__ == "__main__":
    main()
