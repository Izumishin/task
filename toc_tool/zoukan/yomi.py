"""増刊号の著者読み決定：既存Excel辞書 → JMnedict候補 × 索引の五十音順で検証。"""
import re, sqlite3, unicodedata, functools
import pykakasi
import os
DB=os.environ.get("JAMDICT_DB","./jamdict.db")
_c=sqlite3.connect(DB); _k=pykakasi.kakasi()
KJ="一-鿿々ヶ豈-﫿㐀-䶿"
SMALL=str.maketrans("ぁぃぅぇぉっゃゅょゎ","あいうえおつやゆよわ")
def kata2hira(s): return "".join(chr(ord(c)-0x60) if "ァ"<=c<="ヶ" else c for c in s)
def okey(h):
    """五十音順の比較キー（清音化・小書き正規化・長音除去）＋同順位用に元の文字列。"""
    h=kata2hira(h).replace("ー","").replace("　","").replace(" ","")
    base="".join(ch for ch in unicodedata.normalize("NFD",h) if ch not in "゙゚")
    return (unicodedata.normalize("NFC",base).translate(SMALL), h)
def head_kana(h):
    return okey(h)[0][:1]
ITAIJI=str.maketrans({"髙":"高","﨑":"崎","德":"徳","濵":"浜","栁":"柳","邉":"辺","邊":"辺","𠮷":"吉","塚":"塚","槇":"槙","惠":"恵","眞":"真","澤":"沢","廣":"広","國":"国","齋":"斎","齊":"斉","藏":"蔵","瀨":"瀬","櫻":"桜","髮":"髪"})
@functools.lru_cache(None)
def jm(word):
    r=_jm(word)
    if not r and word.translate(ITAIJI)!=word: r=_jm(word.translate(ITAIJI))
    return r
def _jm(word):
    q="""select n.text, group_concat(distinct t.text), count(distinct k.idseq) from NEKanji k join NEKana n on n.idseq=k.idseq
         left join NETranslation tr on tr.idseq=k.idseq left join NETransType t on t.tid=tr.ID
         where k.text=? group by n.text"""
    return [(r, set((ty or "").split(",")), n) for r,ty,n in _c.execute(q,(word,)).fetchall()]
@functools.lru_cache(None)
def kks(word): return "".join(x["hira"] for x in _k.convert(word.translate(ITAIJI)))
def part_cands(word, role):
    """姓/名の読み候補と事前スコア。role='sei'|'mei'"""
    want={"surname","place"} if role=="sei" else {"given","masc","fem"}
    out={}
    pk=kks(word)
    for r,ty,n in jm(word):
        s=(3 if ty & want else (1 if "unclass" in ty else 0))+min(n-1,2)*0.3
        if r==pk: s+=(2 if role=="sei" else 0.5)
        if role=="mei" and ty & {"given","masc","fem"} and len(ty & {"given","masc","fem"})>=2: s+=0.3
        out[r]=max(out.get(r,-9),s)
    if pk and re.fullmatch(r"[ぁ-んー]+",pk): out.setdefault(pk,1)
    if re.fullmatch(r"[ぁ-んァ-ヶー]+",word): out={kata2hira(word):5}
    return sorted(out.items(),key=lambda x:-x[1])[:6]
def split_name(name):
    """『井藤　佳恵』→(井藤,佳恵)。空白なしは辞書で最もらしい切れ目を選ぶ。"""
    parts=[p for p in re.split(r"[ 　 ]+",name.strip()) if p]
    if len(parts)==2: return tuple(parts)
    s="".join(parts); best=None
    if len(s)<2: return s,""
    for k in range(1,len(s)):
        a,b=s[:k],s[k:]
        sa=max([3 if ty & {"surname"} else 0 for _,ty,_n in jm(a)]+[0])
        sb=max([3 if ty & {"given","masc","fem"} else 0 for _,ty,_n in jm(b)]+[0])
        sc=sa+sb+(0.5 if 2<=k<=3 else 0)
        if best is None or sc>best[0]: best=(sc,a,b)
    return best[1],best[2]
def candidates(name):
    sei,mei=split_name(name)
    out=[]
    for rs,ss in part_cands(sei,"sei"):
        for rm,sm in (part_cands(mei,"mei") if mei else [("",0)]):
            out.append((rs+"　"+rm, ss+sm))
    return sorted(out,key=lambda x:-x[1])

def parse_index(P, start=404, end=410):
    """人名索引 → [{'name','codes','head'}]（誌面の並び順）。"""
    out=[]; head=None; cur=None
    for p in range(start,end+1):
        for raw in P.get(p,"").split("\n"):
            s=re.sub(r"[\x00-\x1f]","",raw).strip()
            if not s or ".indb" in s or re.fullmatch(r"\d{1,3}",s) or s.startswith("老年精神医学雑誌") or re.match(r"\d{4}/\d\d/\d\d",s): continue
            if re.fullmatch(r"[あ-んA-Z]",s): head=s; cur=None; continue
            if re.fullmatch(r"[A-Z0-9\-‐, ]+,?",s) or s=="認":
                if cur: cur["codes"]+=[c.strip() for c in s.replace("‐","-").split(",") if c.strip()]
                continue
            cur=dict(name=s,codes=[],head=head); out.append(cur)
    return [e for e in out if e["codes"]]
def resolve_index(entries, excel_dict, norm):
    """索引の並び（五十音順）とかな見出しで読み候補を絞る。"""
    jp=[e for e in entries if e["head"] and re.fullmatch(r"[あ-ん]",e["head"])]
    for e in jp:
        k=norm(e["name"])
        if k in excel_dict:
            e["cands"]=[(excel_dict[k],99)]; e["src"]="dict"; continue
        cs=[(r,s) for r,s in candidates(e["name"]) if head_kana(r)==e["head"]]
        allc=candidates(e["name"])
        e["cands"]=cs or allc[:1] or [("",0)]
        e["src"]="guess" if cs else "nohead"
    # 前後の確定読み（辞書・一意）に挟まれる範囲で候補を絞る（収束まで反復）
    for _ in range(4):
        fixed=[i for i,e in enumerate(jp) if len(e["cands"])==1]
        for i,e in enumerate(jp):
            if len(e["cands"])<=1: continue
            lo=max([j for j in fixed if j<i],default=None); hi=min([j for j in fixed if j>i],default=None)
            lk=okey(jp[lo]["cands"][0][0]) if lo is not None else None
            hk=okey(jp[hi]["cands"][0][0]) if hi is not None else None
            keep=[(r,s) for r,s in e["cands"] if (lk is None or okey(r)[0]>=lk[0]) and (hk is None or okey(r)[0]<=hk[0])]
            if keep: e["cands"]=keep
            if len(keep)==1 and e["src"]=="guess": e["src"]="index"
    for e in jp:
        e["yomi"]=e["cands"][0][0]
    return jp

# ---- 既存Excelの読みから「姓／名の漢字→読み」の頻度を作り、候補選びの事前知識にする
from collections import Counter, defaultdict
PRIOR={"sei":defaultdict(Counter),"mei":defaultdict(Counter)}
def learn_prior(pairs):
    for name,yomi in pairs:
        if not name or not yomi or "　" not in yomi or re.match(r"[A-Za-z]",name): continue
        ys,ym=yomi.split("　",1)
        sei,mei=split_name(name)
        if sei and ys: PRIOR["sei"][sei][ys]+=1
        if mei and ym: PRIOR["mei"][mei][ym]+=1
_part_cands_base=part_cands
def part_cands(word, role):
    c=dict(_part_cands_base(word, role))
    for r,n in PRIOR[role].get(word,{}).items():
        c[r]=c.get(r,3)+1.5+min(n,3)*0.5
    return sorted(c.items(),key=lambda x:-x[1])[:6]
