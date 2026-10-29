import fitz, glob, sys, re
import os; sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),".."))
import toc_lib
import os
U=os.environ.get("ZK_PDF_DIR","./pdf/")
GLOB=os.environ.get("ZK_PDF_GLOB","*.pdf")
def load_pages():
    """誌面頁番号 -> テキスト。頁番号は先頭3行内の数字だけの行（奇数頁は柱の次行）。"""
    pages={}
    for f in sorted(glob.glob(U+GLOB)):
        d=fitz.open(f)
        for i in range(d.page_count):
            t=toc_lib.normalize_symbols(d[i].get_text())
            head=[l.strip() for l in t.split("\n")[:3]]
            num=next((int(h) for h in head if re.fullmatch(r"\d{1,3}",h)),None)
            if num is None:  # 柱だけ・番号なし頁は .indb 行から拾う
                m=re.search(r"\.indb\s+(\d{1,3})",t)
                num=int(m.group(1)) if m else None
            if num is not None: pages.setdefault(num,t)
    return pages
