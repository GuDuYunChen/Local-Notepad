"""Exercise the real read-only endpoint against an isolated CI database only."""
import json
import sys
import subprocess
from pathlib import Path
import urllib.parse
import urllib.request

base = sys.argv[1]

def call(path, method="GET", data=None, expected=0):
    request = urllib.request.Request(base + path, method=method,
        data=None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8"),
        headers={"Origin": "null", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        value = json.load(response)
    assert (value["code"] == 0) == (expected == 0), value
    return value.get("data") if expected == 0 else value

def search(**options):
    return call("/api/search?" + urllib.parse.urlencode(options))

project = call("/api/files", "POST", {"title": "Global Search CI Fixture", "is_folder": True})
volume = call("/api/files", "POST", {"title": "第一卷", "is_folder": True, "parent_id": project["id"]})
word = "检索验收词"
files = []
for index in range(65):
    content = json.dumps({"root": {"type": "root", "children": [{"type": "paragraph", "children": [
        {"type": "text", "text": "😀检索"}, {"type": "text", "text": "验收词", "format": 1},
        {"type": "text", "text": " 100%_ A+B" if index == 0 else ""}]}]}}, ensure_ascii=False)
    files.append(call("/api/files", "POST", {"title": f"检索样例 {index:03d}.md", "content": content, "parent_id": volume["id"]}))
call("/api/files/" + files[0]["id"], "PUT", {"is_pinned": True})
first = search(q=word, folder_id=project["id"], size=20, sort="title")
assert first["cache_hits"] + first["parsed"] == first["scanned"], first
assert first["total"] == 65 and first["pages"] == 4 and len(first["items"]) == 20, first
assert first["items"][0]["snippets"][0]["start"] == 2, first["items"][0]
assert "content" not in first["items"][0], first["items"][0]
all_ids = set(item["id"] for item in first["items"])
for page in (2, 3, 4):
    batch = search(q=word, folder_id=project["id"], size=20, page=page, sort="title", revision=first["revision"])
    assert batch["parsed"] == 0 and batch["cache_hits"] == batch["scanned"], batch
    all_ids.update(item["id"] for item in batch["items"])
assert len(all_ids) == 65, len(all_ids)
subprocess.run(["node", str(Path(__file__).with_name("search-result-export-smoke.mjs")), base, project["id"]], check=True)
anchored = search(q=word, folder_id=project["id"], size=20, sort="title", anchor_id=files[-1]["id"])
assert anchored["anchor_found"] and anchored["page"] == 4 and anchored["anchor_id"] == files[-1]["id"], anchored
call("/api/files/" + files[-1]["id"], "PUT", {"title": "000-移至首条.md"})
returned = search(q=word, folder_id=project["id"], size=20, sort="title", page=4, anchor_id=files[-1]["id"])
assert returned["anchor_found"] and returned["page"] == 1 and returned["items"][0]["id"] == files[-1]["id"], returned
missing = search(q=word, folder_id=project["id"], pinned=1, anchor_id=files[-1]["id"])
assert not missing["anchor_found"] and missing["total"] == 1, missing
assert search(q=word, folder_id=project["id"], pinned=1)["total"] == 1
assert search(q=word, folder_id=project["id"], source="title")["total"] == 0
assert search(q="paragraph", folder_id=project["id"])["total"] == 0
assert search(q="100%_ A+B", folder_id=project["id"])["total"] == 1
assert search(q=word, folder_id=project["id"], since=9999999999)["total"] == 0
call("/api/search?folder_id=missing-scope", expected=1)
call("/api/files/" + files[0]["id"], "PUT", {"content": word + " body changed"})
call("/api/search?" + urllib.parse.urlencode({"q": word, "folder_id": project["id"], "sort": "title", "page": 2, "revision": first["revision"]}), expected=1)
assert search(q=word, folder_id=project["id"])["total"] == 65
call("/api/files/" + project["id"], "DELETE")
assert search(q=word)["total"] == 0
call("/api/files/" + project["id"] + "/permanent", "DELETE")
print("Global search HTTP smoke passed: 65 notes, 4 pages, literal Unicode, formatted text, directory/source/pinned/date filters, metadata exclusion, revision invalidation, deleted scopes, no body payload, identity-based return after saved rename.")
