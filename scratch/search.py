import sys

with open(r"d:\AI\nanoPD_Pro\scratch\search_output.txt", "r", encoding="utf-8") as f:
    text = f.read()

matches = text.split("--- MATCH ")
output_lines = []
output_lines.append(f"Total MATCH blocks: {len(matches)}")

for m in matches:
    if "16" in m or "17" in m:
        lines = m.split("\n")
        relevant_lines = []
        for line in lines:
            if any(w in line for w in ["16", "17", "disappear", "missing", "丢失"]):
                relevant_lines.append(line.strip())
        if relevant_lines:
            header = lines[0] if lines else "Match Block"
            output_lines.append(f"\nBlock: {header[:100]}")
            for rl in relevant_lines[:15]:
                output_lines.append(f"  -> {rl[:200]}")

with open(r"d:\AI\nanoPD_Pro\scratch\matches.txt", "w", encoding="utf-8") as out:
    out.write("\n".join(output_lines))

print("Done! Output saved to matches.txt")
