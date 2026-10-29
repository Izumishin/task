import sys,re,json,openpyxl
import os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),".."))
from load import load_pages; from yomi import *; from abst import excel_name, nospace
import toc_lib
SP=os.environ.get("ZK_WORK","./work/")
P=load_pages()
sessions=json.load(open(SP+"sessions.json",encoding="utf-8"))
posters=json.load(open(SP+"posters.json",encoding="utf-8"))
ws=openpyxl.load_workbook(os.environ.get("ZK_EXCEL",SP+"base.xlsx")).active
XD=toc_lib.build_reading_dict(ws)
learn_prior([(ws.cell(row=r,column=4).value,ws.cell(row=r,column=9).value) for r in range(2,ws.max_row+1)])
norm=toc_lib._norm_name
# 索引で読みを推定（並び順・かな見出し）
IDX={norm(e["name"]):e for e in resolve_index(parse_index(P),XD,norm)}
MANUAL={  # 辞書に候補がない名前（索引の見出しかなと照合済み）
 "郷堀ヨゼフ":"ごうほり　よぜふ","薛載勲":"そる　じぇふん","尹之恩":"ゆん　じうん",
 "武倉アブドグプル":"ぶくら　あぶどぐぷる","クラートウルアインハイダー":"くらーと　うるあいんはいだー",
 "シリアーラヤパノット":"しりあーらや　ぱのっと","フェイバーオミレケ":"ふぇいばー　おみれけ","サンドバールフェリーペ":"さんどばーる　ふぇりーぺ",
}
stats={"dict":0,"index":0,"guess":0,"latin":0,"none":0}
def reading(name):
    """(読み, 要確認?)"""
    if not name: return "",False
    k=norm(name)
    if re.match(r"[A-Za-z]",name):              # 欧文名：去年の慣例「名　姓」
        t=name.split(); stats["latin"]+=1
        return (" ".join(t[:-1])+"　"+t[-1] if len(t)>1 else name), False
    if k in XD: stats["dict"]+=1; return XD[k],False
    if k in MANUAL: stats["guess"]+=1; return MANUAL[k],True
    if k in IDX and IDX[k]["yomi"]:
        e=IDX[k]
        if e["src"]=="index": stats["index"]+=1
        else: stats["guess"]+=1
        return e["yomi"],True
    c=candidates(name)
    if c and c[0][0].strip("　"): stats["guess"]+=1; return c[0][0],True
    stats["none"]+=1; return "",True
R=[]
def row(title,author="",page=None,code=None):
    title=re.sub(r"[\x00-\x08\x0b-\x1f]","",title)
    y,u=reading(author)
    R.append(dict(title=title,author=excel_name(author) if author else "",page=page,reading=y,uncertain=u,code=code))
HEAD="第41 回日本老年精神医学会　第45 回日本認知症学会学術集会\n合同大会（JCDP2026）　プログラム・抄録集\nテーマ：認知症の未来を共に創る"
R.append(dict(title=HEAD,author="",page=None,reading="",uncertain=False,header=True))
for t,a,p in [("会長挨拶","新井　哲明",3),("交通案内／会場案内","",4),("参加者へのご案内","",8),("単位のご案内","",12),
              ("座長・演者へのご案内","",14),("日程表","",18),("組織（査読委員）","",24)]: row(t,a,p)
row("第41 回日本老年精神医学会　第45 回日本認知症学会学術集会\n合同大会（JCDP2026）　プログラム",page=25)
for t,p in [("　会長講演，特別講演，特別企画，海外招聘講演",26),("　プレナリーレクチャー",27),("　学術教育講演",28),
            ("　シンポジウム",30),("　共催セミナー",53),("　一般演題（ポスター発表）",67)]: row(t,page=p)
row("講演抄録",page=111)
for s in sessions:
    th="".join(s["theme"])
    head="　"+s["head"]+(f"「{th}」" if th else "")
    row(head,page=s["items"][0]["apage"] if s["items"] else None)
    for it in s["items"]:
        t=f"　　{it['code']}　{it['title']}"
        if it["authors"]:
            for a in it["authors"]: row(t,a,it["apage"],it["code"])
        else: row(t,page=it["apage"],code=it["code"])
row("　日本認知症学会　学会賞受賞講演",page=212)
row("　　細胞外タウの放出から排出まで―神経変性疾患の新たな病態理解","山田　　薫",212)
row("一般演題抄録",page=213); row("　ポスター発表",page=214)
for c in sorted(posters):
    e=posters[c]; row(f"　　{c}　{e['title']}",e.get("speaker") or "",e["apage"],c)
row("　　索引",page=403)
json.dump(R,open(SP+"rows.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print("総行数:",len(R),"／ 著者行:",sum(1 for r in R if r["author"]),"／ 読みの内訳:",stats)
print("要確認(黄色):",sum(1 for r in R if r["uncertain"]))
