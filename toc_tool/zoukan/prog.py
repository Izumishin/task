import re
SKIP=re.compile(r"(\.indb|^\d{4}/\d{2}/\d{2}|^老年精神医学雑誌　第37|^\d{1,3}$)")
MAJOR=["会長講演","特別講演","特別企画","海外招聘講演","プレナリーレクチャー","学術教育講演",
       "シンポジウム","共催セミナー","ポスター発表","日本認知症学会 学会賞受賞講演","学会賞受賞講演"]
CODE=re.compile(r"^(CL|SL|SP-\d+|IL\d+|PLL\d+|EL\d+|SY\d+-\d+|AW\d*|LS\d+(?:-\d+)?|ES\d+(?:-\d+)?|MS\d+(?:-\d+)?|P\d{3})\s+(.*)$")
SUB=re.compile(r"^(海外招聘講演|プレナリーレクチャー|学術教育講演|シンポジウム|ランチョンセミナー|イブニングセミナー|モーニングセミナー|共催セミナー)\s*\d+$")
DATE=re.compile(r"^\d{1,2}月\d{1,2}日（.）")
KJ="一-鿿々ヶぁ-んァ-ヶー豈-\uFAFF㐀-䶿"
NAME=rf"(?:[{KJ}]{{1,6}}[　 ]*[{KJ}]{{0,6}}|[A-Z][A-Za-z\.\-’' ]{{1,45}})"
SPEAKER=re.compile(rf"^({NAME})（(.*)$")
def parse_program(P, start, end):
    ev=[]; cur=None
    for p in range(start,end+1):
        for raw in P.get(p,"").split("\n"):
            s=raw.strip()
            if not s or SKIP.search(s): continue
            s=s.replace("‐","-")
            if s in MAJOR: ev.append(dict(kind="major",text=s,page=p)); cur=None; continue
            if SUB.match(s): ev.append(dict(kind="sub",text=s,page=p)); cur=None; continue
            if DATE.match(s): continue
            if s.startswith("座長："): ev.append(dict(kind="chair",text=s[3:],page=p)); cur=None; continue
            m=CODE.match(s)
            if m:
                cur=dict(kind="item",code=m.group(1),title=m.group(2).strip(),speaker=None,aff="",page=p); ev.append(cur); continue
            if cur is not None and cur["speaker"] is None:
                sm=SPEAKER.match(s)
                nm=sm.group(1) if sm else ""
                if sm and (re.match(r"[A-Z]",nm) or len(nm.replace(" ","").replace("　",""))<=12):
                    cur["speaker"]=sm.group(1).strip(); cur["aff"]=sm.group(2); continue
                cur["title"]+=("" if re.search(r"[A-Za-z]$",cur["title"]) is None else " ")+s; continue
            if cur is not None and cur["speaker"] is not None and not cur["aff"].endswith("）"):
                cur["aff"]+=s; continue
            if ev and ev[-1]["kind"]=="chair" and not ev[-1]["text"].endswith("）"):
                ev[-1]["text"]+=s; continue
            # 座長2人目・テーマ行
            if ev and ev[-1]["kind"]=="chair" and re.match(rf"^{NAME}（",s):
                ev.append(dict(kind="chair",text=s,page=p)); continue
            ev.append(dict(kind="text",text=s,page=p)); cur=None
    return ev
