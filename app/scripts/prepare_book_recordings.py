"""Publish metadata for verified local source recordings; never copy MP3 files."""
import hashlib
from intake_new_coursebooks import APP, ROOT, atomic_json, read_json


def main():
    intake=read_json(APP/"content/new-coursebooks-intake.json")
    recordings=[]
    for collection in intake["audio"]:
        for track in collection["tracks"]:
            path=ROOT/"книги"/track["filename"]
            raw=path.read_bytes()
            if hashlib.sha256(raw).hexdigest()!=track["sha256"]:
                raise ValueError("Audio source changed after intake")
            recordings.append({"id":f"{collection['coursebookId']}-track-{track['track']:03d}.mp3",
                "bookId":collection["coursebookId"],"unitId":track["unitId"],"task":track["task"],"track":track["track"],
                "filename":track["filename"],"sha256":track["sha256"],"bytes":len(raw),"durationSeconds":track["durationSeconds"]})
    if len({r["id"] for r in recordings})!=len(recordings):raise ValueError("Duplicate audio IDs")
    result={"version":1,"sourceRoot":"книги","recordings":recordings,
            "notes":["Clear Speech Third Edition Student Audio CD mapping verified against PDF194 / printed174.",
                     "These are selected Student CD exercises; Classroom Audio and Viewpoint recordings are not supplied.",
                     "Original MP3 files stay local; only IDs, paths, hashes and learning references are distributed."]}
    atomic_json(APP/"content/book-recordings.json",result)
    print(f"Prepared {len(recordings)} verified local recording entries; no MP3 files copied")


if __name__=="__main__":main()
