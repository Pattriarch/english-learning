"""Build the reviewed chapter inventory for the six new supplied Student Books.

The chapter titles and printed starts were transcribed from the supplied TOCs.
Physical PDF starts are separately verified against rendered chapter headings.
This metadata file does not register or publish new lessons in library.json.
"""
from pathlib import Path
import hashlib
import json
import re

import pymupdf
from intake_new_coursebooks import APP, ROOT, OUT, BOOKS, atomic_json, read_json
from book_source_contract import pdf_source_path

SPECS = {
 "clear-speech-3": {"title":"Clear Speech", "edition":"Third Edition", "year":2005,"kind":"pronunciation", "tocPages":[6,7],"offset":20,"teachingEnd":138,
  "units":[(2,"Syllables"),(10,"Vowels and vowel rules"),(18,"Word stress and vowel length"),(25,"Word stress and vowel clarity"),(34,"Word stress patterns"),(44,"Sentence focus: Emphasizing content words"),(50,"Sentence focus: De-emphasizing structure words"),(59,"Choosing the focus word"),(69,"Emphasizing structure words"),(76,"Continuants and stops: /s/ and /t/"),(84,"Continuants and stops: /r/ and /d/, /l/ and /d/"),(97,"Voicing"),(109,"Voicing and syllable length"),(119,"Sibilants"),(129,"Thought groups")],
  "supplements":[(139,139,"Appendix A: Parts of the mouth"),(140,141,"Appendix B: Tongue shapes"),(142,162,"Appendix C: More consonant work"),(163,172,"Appendix D: Advanced tasks"),(173,173,"Appendix E: How often do the vowel rules work?"),(174,174,"Track listing for Student Audio CD")],"companions":[],
  "missing":["Classroom Audio for exercises absent from the supplied Student Audio CD", "Teacher's Resource Book, Third Edition"],
  "notes":["Handwritten answers are visible in the scan and are not verified answer keys.","Student Audio CD contains 82 tracks for selected exercises; audio coverage must be mapped per exercise."]},
 "great-writing-1-4": {"title":"Great Writing 1: Great Sentences for Great Paragraphs","edition":"Fourth Edition","year":2014,"kind":"writing","tocPages":[4,5],"offset":17,"teachingEnd":228,
  "units":[(2,"Understanding Sentence Basics"),(32,"Understanding Paragraph Basics"),(70,"Writing about the Present"),(98,"Writing about the Past"),(128,"Describing Actions"),(152,"Writing about the Future"),(180,"Writing Complex Sentences with Adjective Clauses"),(206,"Pulling It All Together and Preparing for More")],
  "supplements":[(229,250,"Brief Writer's Handbook"),(251,251,"Appendices: contents"),(252,257,"Appendix 1: Building Better Sentences"),(258,266,"Appendix 2: Extra Writing Activities"),(267,267,"Appendix 3: Peer Editing Sheet Sample"),(268,270,"Index")],"companions":[],"missing":["Answer Key / Teacher's Notes"],"notes":[]},
 "great-writing-2-4": {"title":"Great Writing 2: Great Paragraphs","edition":"Fourth Edition","year":2014,"kind":"writing","tocPages":[5],"offset":17,"teachingEnd":242,
  "units":[(2,"Paragraphs"),(32,"Developing Ideas for Writing a Paragraph"),(46,"Topic Sentences"),(70,"Supporting and Concluding Sentences"),(94,"Paragraph Review"),(116,"Definition Paragraphs"),(138,"Process Paragraphs"),(154,"Descriptive Paragraphs"),(180,"Opinion Paragraphs"),(198,"Narrative Paragraphs"),(222,"Paragraphs in an Essay: Putting It All Together")],
  "supplements":[(243,281,"Brief Writer's Handbook with Activities"),(282,282,"Appendices: contents"),(283,298,"Appendix 1: Building Better Sentences"),(299,300,"Appendix 2: Peer Editing Sheet Sample"),(301,304,"Index")],"companions":[],"missing":["Answer Key / Teacher's Notes"],"notes":["Frontmatter is not in printed-page order: printed iv precedes iii; main-unit numbering was verified separately."]},
 "great-writing-3-3": {"title":"Great Writing 3: From Great Paragraphs to Great Essays","edition":"Third Edition","year":2015,"kind":"writing","tocPages":[4],"offset":15,"teachingEnd":189,
  "units":[(2,"Introduction to Paragraphs"),(38,"Five Elements of Good Writing"),(64,"Types of Paragraphs"),(90,"Descriptive Essays: Moving from Paragraph to Essay"),(114,"Comparison Essays"),(138,"Cause-Effect Essays"),(164,"Classification Essays")],
  "supplements":[(190,229,"Brief Writer's Handbook with Activities"),(231,231,"Appendices: contents"),(232,245,"Appendix 1: Building Better Sentences"),(246,246,"Appendix 2: Peer Editing Sheet Sample"),(247,250,"Index")],"companions":["great-writing-3-key","great-writing-3-notes"],"missing":[],"notes":["Printed page 230 is absent: PDF 244 is printed 229; PDF 245 is printed 231. No missing page is synthesized."]},
 "great-writing-4-4": {"title":"Great Writing 4: Great Essays","edition":"Fourth Edition","year":2014,"kind":"writing","tocPages":[4],"offset":15,"teachingEnd":154,
  "units":[(2,"Exploring the Essay"),(38,"Narrative Essays"),(64,"Comparison Essays"),(88,"Cause-Effect Essays"),(112,"Argument Essays"),(136,"Other Forms of Academic Writing")],
  "supplements":[(155,188,"Brief Writer's Handbook with Activities"),(189,189,"Appendices: contents"),(190,207,"Appendix 1: Building Better Sentences"),(208,208,"Appendix 2: Peer Editing Sheet Sample"),(209,212,"Index")],"companions":["great-writing-4-key","great-writing-4-notes"],"missing":[],"notes":[]},
 "viewpoint-1": {"title":"Viewpoint 1","edition":"Student's Book, Cambridge","year":2012,"kind":"integrated-conversation","tocPages":[4,5,6,7,8,9],"offset":0,"teachingEnd":135,
  "units":[(10,"Social networks"),(20,"The media"),(30,"Stories"),(42,"Working lives"),(52,"Challenges"),(62,"Into the future"),(74,"Getting along"),(84,"Food science"),(94,"Success and happiness"),(106,"Going places"),(116,"Culture"),(126,"Ability")],
  "supplements":[(40,41,"Checkpoint 1: Units 1-3"),(72,73,"Checkpoint 2: Units 4-6"),(104,105,"Checkpoint 3: Units 7-9"),(136,137,"Checkpoint 4: Units 10-12"),(138,143,"Speaking naturally"),(144,167,"Grammar extra"),(168,170,"Credits and backmatter")],
  "companions":["viewpoint-1-te","viewpoint-1-workbook","viewpoint-1-cefr","viewpoint-1-video-worksheets"],"missing":["Classroom Audio", "Video recordings"],"notes":["The supplied CEFR Guide maps this level to B2.","Worksheets and video scripts are present, but no Viewpoint audio or video media is supplied."]}
}
COMPANIONS = {
 "great-writing-3-key": ("Great_Writing_3_-_Answer_Key.pdf","answer-key","great-writing-3-3"),
 "great-writing-3-notes": ("Great_Writing_3_-_Teacher_39_s_Notes.pdf","teacher-notes","great-writing-3-3"),
 "great-writing-4-key": ("Great_Writing_4_Answer_Key.pdf","answer-key","great-writing-4-4"),
 "great-writing-4-notes": ("Great_Writing_4_Teacher_39_s_Notes.pdf","teacher-notes","great-writing-4-4"),
 "viewpoint-1-te": ("Viewpoint_1_TE.pdf","teacher-edition","viewpoint-1"),
 "viewpoint-1-workbook": ("Viewpoint_1_workbook.pdf","workbook","viewpoint-1"),
 "viewpoint-1-cefr": ("Viewpoint_1_CEFR_Guide.pdf","cefr-guide","viewpoint-1"),
 "viewpoint-1-video-worksheets": ("Viewpoint_1_video_activity_worksheets.pdf","video-worksheets-and-scripts","viewpoint-1"),
 "viewpoint-2-workbook": ("viewpoint_2_workbook.pdf","workbook","viewpoint-2-missing-student-book"),
}
# Transcribed against the actual Student Audio CD table (PDF 194, printed 174).
CLEAR_TRACK_TASKS = ["ACDKMO","BEIJOPS","CDEI","CDFHL","BFGHJN","BDG","FGHIK","ACEKM","BHKLM","CDEIJ","CDFGHKNOQ","ABCFILPU","ABFN","ACDIL","CDGIK"]
COMPANION_UNIT_RANGES = {
    "great-writing-3-key": [(1,2),(2,3),(3,4),(4,6),(6,7),(7,9),(9,10)],
    "great-writing-3-notes": [(2,13),(14,23),(24,32),(33,41),(42,50),(51,59),(60,70)],
    "great-writing-4-key": [(1,3),(3,4),(4,6),(6,7),(7,8),(8,8)],
    "great-writing-4-notes": [(2,12),(13,20),(21,26),(27,33),(34,41),(42,48)],
    "viewpoint-1-te": [(1,12),(13,24),(25,38),(39,50),(51,62),(63,75),(76,87),(88,98),(99,113),(114,125),(126,137),(138,151)],
    "viewpoint-1-workbook": [(3+8*i,10+8*i) for i in range(12)],
    "viewpoint-1-video-worksheets": [(5+4*i,8+4*i) for i in range(12)],
    "viewpoint-1-cefr": [(10,11),(12,12),(13,13),(14,14),(15,15),(16,16),(17,18),(19,19),(20,20),(21,21),(22,22),(23,23)],
    "viewpoint-2-workbook": [(4+8*i,11+8*i) for i in range(12)],
}


def clear_audio():
    duration_rows=read_json(APP/"data/new-books-inspection/audio/inventory.json")
    durations={row["Name"]:row["DurationSeconds"] for row in duration_rows}
    result=[]
    for unit,tasks in enumerate(CLEAR_TRACK_TASKS,1):
        for task in tasks:
            track=len(result)+1
            name=f"{track:02d}.mp3"
            relative="more/Clear Speech Audio CD/"+name
            path=ROOT/"книги"/relative
            if not path.is_file(): raise ValueError("Missing Student CD track "+name)
            result.append({"track":track,"unitId":f"clear-speech-3-{unit:03d}","task":task,"filename":relative,
                           "durationSeconds":durations[name],"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
                           "mappingSource":{"pdfPage":194,"printedPage":174},
                           "recordingContentSpotChecked":track in (1,2,82)})
    if len(result)!=82: raise ValueError("Student Audio CD table must have 82 tracks")
    return {"id":"clear-speech-3-student-audio","coursebookId":"clear-speech-3","kind":"student-audio-cd", "tracks":result,
            "coverage":"Selected book exercises only; not the complete Classroom Audio program."}


def physical_page(identifier, printed):
    if identifier == "great-writing-3-3" and printed == 230:
        raise ValueError("Printed page 230 is absent from the supplied GW3 PDF")
    return printed + SPECS[identifier]["offset"] - int(identifier == "great-writing-3-3" and printed > 230)


def pdf_identity(filename):
    path = pdf_source_path(ROOT / "книги", filename)
    with pymupdf.open(path) as document:
        pages = len(document)
    return {"filename": filename,"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"pdfPageCount":pages}


def build_manifest():
    books=[]
    for identifier,spec in SPECS.items():
        identity = pdf_identity("more/"+BOOKS[identifier])
        units=[]
        for index,(start,title) in enumerate(spec["units"]):
            end=spec["units"][index+1][0]-1 if index+1<len(spec["units"]) else spec["teachingEnd"]
            if identifier == "viewpoint-1": end=start+9
            first,last=physical_page(identifier,start),physical_page(identifier,end)
            units.append({"id":f"{identifier}-{index+1:03d}","unit":index+1,"title":title,
                          "printedPage":start,"printedEndPage":end,"page":first,"endPage":last,
                          "pages":list(range(first,last+1)),"companionRefs":spec["companions"],
                          "sourceStatus":"extracted-not-a-published-lesson"})
            if identifier=="clear-speech-3":
                first_track=1+sum(len(tasks) for tasks in CLEAR_TRACK_TASKS[:index])
                units[-1]["audioTracks"]=list(range(first_track,first_track+len(CLEAR_TRACK_TASKS[index])))
            units[-1]["companionUnits"]=[{"companionId":ref,"pages":list(range(COMPANION_UNIT_RANGES[ref][index][0],COMPANION_UNIT_RANGES[ref][index][1]+1))}
                                         for ref in spec["companions"] if ref in COMPANION_UNIT_RANGES]
            if identifier=="viewpoint-1":
                units[-1]["studentSupplementPages"]={"speakingNaturally":[138+index//2],"grammarExtra":[144+2*index,145+2*index]}
                units[-1]["teacherSupplementPages"]={"speakingNaturally":[152+index//2],"grammarExtra":[158+2*index,159+2*index],"languageSummary":[182+index]}
        supplements=[]
        for index,(start,end,title) in enumerate(spec["supplements"]):
            first,last=physical_page(identifier,start),physical_page(identifier,end)
            supplements.append({"id":f"{identifier}-supplement-{index+1:02d}","title":title,"printedPage":start,
                                "printedEndPage":end,"page":first,"endPage":last,"pages":list(range(first,last+1))})
        book={"id":identifier,"title":spec["title"],"edition":spec["edition"],"year":spec["year"],"kind":spec["kind"],
              **identity,"tocPages":spec["tocPages"],"unitCount":len(units),"units":units,"supplements":supplements,
              "frontmatterPages":list(range(1,units[0]["page"])),"companionRefs":spec["companions"],
              "missingMaterials":spec["missing"],"notes":spec["notes"],
              "boundaryVerification":"TOC starts transcribed from page images; each physical chapter-start title checked visually. Printed-page mapping checked against the TOC and available footers."}
        validate_book(book)
        books.append(book)
    companions=[]
    for identifier,(filename,kind,parent) in COMPANIONS.items():
        identity=pdf_identity("more/"+filename)
        with pymupdf.open(pdf_source_path(ROOT / "книги",identity["filename"])) as document:
            native=[{"page":i+1,"text":p.get_text("text",sort=True)} for i,p in enumerate(document)]
        folder=OUT/"companions"/identifier
        atomic_json(folder/"native-pages.json",native)
        extracted=OUT/identifier/"pages.json"
        extracted_pages=read_json(extracted)["pages"] if extracted.exists() else native
        refs=[]
        # A unit may begin halfway through a key page. A page can therefore
        # reference multiple units; these are anchors, not exclusive ranges.
        for page in extracted_pages:
            numbers=sorted({int(m) for m in re.findall(r"\bUNIT\s+(\d{1,2})\b",page["text"],flags=re.I)})
            if numbers: refs.append({"page":page["page"],"units":numbers})
        companions.append({"id":identifier,**identity,"kind":kind,"coursebookId":parent,"unitMentionAnchors":refs,
                           "unitSourceRanges":[{"unit":i+1,"pages":list(range(start,end+1))} for i,(start,end) in enumerate(COMPANION_UNIT_RANGES.get(identifier,[]))],
                           "mappingStatus":"Conservative unit page ranges from actual headings; key ranges overlap on shared pages. Select answers by printed activity/page IDs and inspect the original columns.",
                           "completeOCRAvailable":extracted.exists(),
                           "nativeTextPages":sum(bool(p["text"].strip()) for p in native),
                           "notAStandaloneCourse":True})
        if extracted.exists() and identifier in COMPANION_UNIT_RANGES:
            by_page={p["page"]:p for p in extracted_pages}
            for unit_number,(start,end) in enumerate(COMPANION_UNIT_RANGES[identifier],1):
                selected=[by_page[number] for number in range(start,end+1)]
                atomic_json(folder/"units"/f"{unit_number:03d}.json",{"companionId":identifier,"unit":unit_number,
                    "filename":identity["filename"],"sha256":identity["sha256"],"pages":list(range(start,end+1)),
                    "text":"\n\n".join(p["text"] for p in selected),
                    "pageTexts":[{"page":p["page"],"text":p["text"],"image":p["image"],"imageSHA256":p["imageSHA256"]} for p in selected],
                    "warnings":["Ranges can include a neighboring unit on a shared source page; follow the actual unit heading and printed activity/page ID.",
                                "OCR retains both columns as geometric rows; attach all original images to interpret answer keys correctly."]})
    return {"schemaVersion":1,"scope":"Six supplied Student Books; 59 major units. Source intake metadata, not lesson publication.",
            "sourceRoot":"книги","sourceDirectory":"app/data/new-coursebooks","books":books,"companions":companions,
            "audio":[clear_audio()],
            "missingCourses":[{"id":"viewpoint-2","available":"Workbook only","missing":["Student's Book","Teacher's Edition","Classroom Audio"]}],
            "totalUnits":sum(b["unitCount"] for b in books),"totalStudentPages":sum(b["pdfPageCount"] for b in books)}


def validate_book(book):
    ownership={p:[] for p in range(1,book["pdfPageCount"]+1)}
    for p in book["frontmatterPages"]: ownership[p].append("frontmatter")
    for unit in book["units"]+book["supplements"]:
        if unit["pages"] != list(range(unit["page"],unit["endPage"]+1)): raise ValueError("Incomplete unit pages")
        for p in unit["pages"]:
            if p not in ownership: raise ValueError(f"Page outside PDF: {book['id']}:{p}")
            ownership[p].append(unit["id"])
    bad={p:owner for p,owner in ownership.items() if len(owner)!=1}
    if bad: raise ValueError(f"Every physical page must have exactly one source owner: {book['id']} {bad}")


if __name__=="__main__":
    result=build_manifest()
    atomic_json(APP/"content/new-coursebooks-intake.json",result)
    print(json.dumps({"books":len(result["books"]),"units":result["totalUnits"],"studentPages":result["totalStudentPages"],"companions":len(result["companions"])}))
