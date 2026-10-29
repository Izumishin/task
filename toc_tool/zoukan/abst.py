import re
KJ="一-鿿々ヶぁ-んァ-ヶー豈-﫿㐀-䶿"
ORG=re.compile(r"(大学|病院|研究所|センター|研究科|学部|講座|株式会社|Inc|Ltd|LLC|Universit|Institut|機構|クリニック|法人|学会|協会|省|医科|医療|教室|分野|部門|GmbH|Company|Products|Hospital|School|College|Japan|USA|UK)")
def norm(s): return s.replace("‐","-").replace("－","-")
def nospace(s): return re.sub(r"[ 　]+","",s)
def find_code_page(P, code, pages):
    pat=re.compile(rf"(?m)^\s*{re.escape(code)}(?=\s|$)")
    for p in pages:
        if pat.search(norm(P.get(p,""))): return p
    return None
def excel_name(raw):
    """誌面の字取り表記（例『瀧　　靖之』）→ Excel表記（1字姓/名のみ全角空白1つ）。"""
    raw=re.sub(r"[\x00-\x1f]","",raw).strip()
    if re.match(r"[A-Za-z]",raw): return re.sub(r"\s+"," ",raw)
    parts=[x for x in re.split(r"[ 　\u2002]+",raw) if x]
    if len(re.findall(r"[ァ-ヶー]",raw))>=3 and len(parts)>=2: return "　".join(parts)   # カタカナの外国人名は区切りを残す
    if len(parts)==2:
        a,b=parts
        return a+"　"+b if (len(a)==1 or len(b)==1) else a+b
    return "".join(parts)
def author_block(P, code, page, presenter):
    """抄録から著者全員（表示順）を返す。発表者名の位置から所属行の手前まで。"""
    txt=norm(P.get(page,""))
    m=re.search(rf"(?m)^\s*{re.escape(code)}(?=\s|$)",txt)
    if not m: return None
    tail=txt[m.end():]
    key=nospace(presenter)
    # 発表者名の開始位置（空白無視で探す）
    flat=[]; idx=[]
    for i,ch in enumerate(tail):
        if ch not in " 　\t": flat.append(ch); idx.append(i)
    fs="".join(flat); k=fs.find(key)
    if k<0 or k>400: return None
    blk=tail[idx[k]:]
    names=[]; buf=""
    SUP=re.compile(r"\d+(?:[，,]\d+)*）")
    for line in blk.split("\n"):
        s=line.strip()
        if not s: continue
        core=SUP.sub("",s); core=re.sub(r"[＊\*]\d*","",core)
        toks=[t for t in re.split(r"[，,、]",core) if t.strip()]
        # 人名列の行：各トークンが短く、組織語・句読点を含まない
        is_names = (not toks) or all(len(nospace(t))<=24 and not ORG.search(t) and not re.search(r"[．。：:（）()]",t) for t in toks)
        if not is_names: break
        buf+=s
        if len(buf)>600: break
    buf=SUP.sub("，",buf); buf=re.sub(r"[＊\*]\d*","",buf)
    for nm in re.split(r"[，,、]",buf):
        nm=nm.strip()
        if nm: names.append(excel_name(nm))
    return names
