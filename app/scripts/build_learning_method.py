"""Publish the project's own method report into the app."""
from pathlib import Path
import html
import re

APP = Path(__file__).resolve().parents[1]
SOURCE = APP / "docs/LEARNING-METHOD-RESEARCH-2026-09-10.md"

def inline(text):
    escaped = html.escape(text)
    def link(match):
        label, url = match.groups()
        if url.startswith("https://"):
            return f'<a href="{url}" target="_blank" rel="noreferrer">{label}</a>'
        if re.fullmatch(r"#/[-a-zA-Z0-9/]+", url):
            return f'<a href="{url}">{label}</a>'
        return f'{label} <span class="small-note">(документ в папке docs проекта)</span>'
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, escaped)

def render(source):
    out, paragraph, listing, table = [], [], False, False
    section = 0
    def flush():
        if paragraph:
            out.append("<p>" + inline(" ".join(paragraph)) + "</p>")
            paragraph.clear()
    for line in source.splitlines() + [""]:
        if line.startswith("|"):
            flush()
            if not table:
                out.append('<div class="method-table"><table>')
                table = True
            cells = [s.strip() for s in line.strip("|").split("|")]
            if all(re.fullmatch(r":?-+:?", cell) for cell in cells):
                continue
            out.append("<tr>" + "".join("<td>" + inline(cell) + "</td>" for cell in cells) + "</tr>")
            continue
        if table:
            out.append("</table></div>")
            table = False
        item = re.match(r"^\d+\. (.+)$", line)
        if item:
            flush()
            if not listing:
                out.append("<ol>")
                listing = True
            out.append("<li>" + inline(item[1]) + "</li>")
            continue
        if listing:
            out.append("</ol>")
            listing = False
        if line.startswith("#"):
            flush()
            level = len(line) - len(line.lstrip("#"))
            section += 1
            out.append(f'<h{level} id="method-{section}">' + inline(line[level:].strip()) + f"</h{level}>")
        elif not line.strip():
            flush()
        else:
            paragraph.append(line.strip())
    return "\n".join(out) + "\n"

if __name__ == "__main__":
    output = APP / "studio/learning-method.html"
    output.write_text(render(SOURCE.read_text(encoding="utf-8")), encoding="utf-8")
    print(f"Published {output.name}: {output.stat().st_size} bytes")
