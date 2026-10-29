import sys,re,json,openpyxl
import os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),".."))
from load import load_pages; from prog import parse_program; from abst import *; from yomi import *
import toc_lib
SP=os.environ.get("ZK_WORK","./work/")
P=load_pages()
SINGLE=re.compile(r"^(CL|SL|SP-\d|IL\d|PLL\d|EL\d+)$")
FIX_FIRST={"SY13-3":"小林　正朋","SY36-2":"太田　俊輔","SY41-2":"山崎　正人"}

# ---- 講演（プログラム部 p26-52 ＋ 抄録頁・共著者）
ev=parse_program(P,26,52)
sessions=[]; cur=None; pending_theme=None
for e in ev:
    if e["kind"]=="major":
        if e["text"] in ("会長講演","特別講演","特別企画"):
            cur=dict(head=e["text"],theme=[],items=[]); sessions.append(cur)
        else: cur=None
        continue
    if e["kind"]=="sub":
        if re.match(r"(海外招聘講演|プレナリーレクチャー|学術教育講演|シンポジウム)\d+$",e["text"]):
            cur=dict(head=e["text"],theme=[],items=[]); sessions.append(cur)
        else: cur=None
        continue
    if cur is None: continue
    if e["kind"]=="text" and re.match(r"^(座[　 ]*長|追加発言|演[　 ]*者)",e["text"]): cur["chaired"]=True; continue
    if e["kind"]=="text" and not cur["items"] and not cur.get("chaired"): cur["theme"].append(e["text"]); continue
    if e["kind"]=="chair": cur["chaired"]=True; continue
    if e["kind"]=="item" and not re.match(r"(LS|ES|MS)",e["code"]): cur["items"].append(e)
for s in sessions:
    for it in s["items"]:
        it["apage"]=find_code_page(P,it["code"],range(112,213))
        sp=it["speaker"]
        if SINGLE.match(it["code"]) or not sp:
            it["authors"]=[excel_name(sp)] if sp else []
        else:
            a=author_block(P,it["code"],it["apage"],sp) or [excel_name(sp)]
            if it["code"] in FIX_FIRST: a[0]=excel_name(FIX_FIRST[it["code"]])
            it["authors"]=a
json.dump(sessions,open(SP+"sessions.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)

# ---- ポスター（プログラム部 p67-110 ＋ 抄録頁）
pev=parse_program(P,67,110)
posters={e["code"]:e for e in pev if e["kind"]=="item" and re.match(r"P\d{3}$",e["code"])}
posters["P025"]=dict(code="P025",title="329HHK331モチーフはアルツハイマー病に特徴的な線維構造の形成に必須である",speaker="佐藤　祐太")
posters["P056"]["speaker"]="クラート　ウル　アイン　ハイダー"
for c,e in posters.items():
    e["apage"]=find_code_page(P,c,range(213,403))
    if "取り下げ" in e["title"]: e["speaker"]=None
json.dump(posters,open(SP+"posters.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print("講演セッション:",len(sessions),"／ 講演演題:",sum(len(s["items"]) for s in sessions),"／ ポスター:",len(posters))
for s in sessions[:6]+sessions[-3:]:
    print(f"  {s['head']} 「{''.join(s['theme'])[:40]}」 演題{len(s['items'])} 先頭p{s['items'][0]['apage'] if s['items'] else None}")
print("テーマ未取得のSY:",[s["head"] for s in sessions if s["head"].startswith("シンポジウム") and not s["theme"]])
print("テーマが2行以上:",[(s["head"],s["theme"]) for s in sessions if len(s["theme"])>1][:8])
