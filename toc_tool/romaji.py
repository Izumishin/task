# -*- coding: utf-8 -*-
"""ヘボン式ローマ字（人名）→ ひらがな 変換。

雑誌本文の著者ローマ字表記（例 "Fumiyoshi Morikawa"）を、総目次Excelの
I列で使う「せい　めい」形式のひらがなへ変換するための補助モジュール。

長音（Koji→こうじ/こじ 等）や撥音・促音は機械的には確定できないため、
本モジュールは「最有力候補」を返しつつ、曖昧なら uncertain=True を立てる。
最終確定は呼び出し側で Excel 既存辞書との照合／人間の確認に委ねる。
"""

# よくある姓・名は辞書で直接確定（長音の揺れを吸収する）。
# キーはローマ字を小文字化・記号除去したもの。値はひらがな。
KNOWN_NAMES = {
    # 姓
    "morikawa": "もりかわ", "murayama": "むらやま", "tabata": "たばた",
    "hirokawa": "ひろかわ", "fukuya": "ふくや", "naoe": "なおえ",
    "fuseya": "ふせや", "kasanuki": "かさぬき", "nakagawa": "なかがわ",
    "shigeta": "しげた", "nomura": "のむら", "nagaoka": "ながおか",
    "sado": "さど", "kashimura": "かしむら", "fujisawa": "ふじさわ",
    "shikimoto": "しきもと", "kitamura": "きたむら", "hattori": "はっとり",
    "fujishiro": "ふじしろ", "kobayashi": "こばやし", "arafuka": "あらふか",
    "nunomura": "ぬのむら", "arai": "あらい", "kishimoto": "きしもと",
    # 名
    "fumiyoshi": "ふみよし", "tomonori": "とものり", "kazuki": "かずき",
    "tatsuyuki": "たつゆき", "shota": "しょうた", "juichiro": "じゅいちろう",
    "kenji": "けんじ", "koji": "こうじ", "atsuo": "あつお",
    "masahiro": "まさひろ", "nobutake": "のぶたけ", "maki": "まき",
    "mitsuhiro": "みつひろ", "masami": "まさみ", "daisuke": "だいすけ",
    "ryo": "りょう", "setsu": "せつ", "hideyuki": "ひでゆき",
    "hiroshige": "ひろしげ", "ryota": "りょうた", "shusei": "しゅうせい",
    "akihiko": "あきひこ", "tetsuaki": "てつあき", "toshifumi": "としふみ",
    "tatsuru": "たつる",
    # Vol.37 No.5（長音・濁点が機械変換で外れやすい実例を辞書化）
    "hikima": "ひきま", "ohkawa": "おおかわ", "okawa": "おおかわ",
    "tsukano": "つかの", "ide": "いで", "takahashi": "たかはし",
    "otsuka": "おおつか", "ohtsuka": "おおつか", "yoshimura": "よしむら",
    "sawamoto": "さわもと", "shimasaki": "しまさき", "kurihara": "くりはら",
    "nishita": "にした", "igarashi": "いがらし", "matsui": "まつい",
    "nagano": "ながの", "ougisawa": "おうぎさわ", "ogisawa": "おうぎさわ",
    "takuya": "たくや", "noriaki": "のりあき", "takuto": "たくと",
    "kaoru": "かおる", "susumu": "すすむ", "yuki": "ゆき", "takako": "たかこ",
    "nobukatsu": "のぶかつ", "ryosuke": "りょうすけ", "masanori": "まさのり",
    "yukiko": "ゆきこ", "yuna": "ゆうな", "tomoyo": "ともよ",
    "nobuko": "のぶこ", "toru": "とおる",
    # Vol.37 No.6
    "murayama": "むらやま", "nakagomi": "なかごみ", "suzuki": "すずき",
    "niimura": "にいむら", "inagaki": "いながき", "numata": "ぬまた",
    "yamamoto": "やまもと", "katagiri": "かたぎり", "nakashima": "なかしま",
    "sugiyama": "すぎやま", "kamiyamasaki": "かみやまさき", "hotta": "ほった",
    "nomura": "のむら", "hiroshi": "ひろし", "atsushi": "あつし",
    "hiroyuki": "ひろゆき", "hidehito": "ひでひと", "asa": "あさ",
    "hanako": "はなこ", "noriko": "のりこ", "yoshitomo": "よしとも",
    "keiko": "けいこ", "taeko": "たえこ", "kei": "けい", "etsuyo": "えつよ",
    "maki": "まき", "koichi": "こういち",
}

# 2文字の子音＋母音／特殊音の変換表（長い綴りを優先してマッチ）。
_ROMAJI_TABLE = [
    ("kya", "きゃ"), ("kyu", "きゅ"), ("kyo", "きょ"),
    ("sha", "しゃ"), ("shu", "しゅ"), ("sho", "しょ"), ("shi", "し"),
    ("cha", "ちゃ"), ("chu", "ちゅ"), ("cho", "ちょ"), ("chi", "ち"),
    ("tsu", "つ"),
    ("nya", "にゃ"), ("nyu", "にゅ"), ("nyo", "にょ"),
    ("hya", "ひゃ"), ("hyu", "ひゅ"), ("hyo", "ひょ"),
    ("mya", "みゃ"), ("myu", "みゅ"), ("myo", "みょ"),
    ("rya", "りゃ"), ("ryu", "りゅ"), ("ryo", "りょ"),
    ("gya", "ぎゃ"), ("gyu", "ぎゅ"), ("gyo", "ぎょ"),
    ("ja", "じゃ"), ("ju", "じゅ"), ("jo", "じょ"), ("ji", "じ"),
    ("bya", "びゃ"), ("byu", "びゅ"), ("byo", "びょ"),
    ("pya", "ぴゃ"), ("pyu", "ぴゅ"), ("pyo", "ぴょ"),
    ("ka", "か"), ("ki", "き"), ("ku", "く"), ("ke", "け"), ("ko", "こ"),
    ("sa", "さ"), ("su", "す"), ("se", "せ"), ("so", "そ"),
    ("ta", "た"), ("te", "て"), ("to", "と"),
    ("na", "な"), ("ni", "に"), ("nu", "ぬ"), ("ne", "ね"), ("no", "の"),
    ("ha", "は"), ("hi", "ひ"), ("fu", "ふ"), ("he", "へ"), ("ho", "ほ"),
    ("ma", "ま"), ("mi", "み"), ("mu", "む"), ("me", "め"), ("mo", "も"),
    ("ya", "や"), ("yu", "ゆ"), ("yo", "よ"),
    ("ra", "ら"), ("ri", "り"), ("ru", "る"), ("re", "れ"), ("ro", "ろ"),
    ("wa", "わ"), ("wo", "を"),
    ("ga", "が"), ("gi", "ぎ"), ("gu", "ぐ"), ("ge", "げ"), ("go", "ご"),
    ("za", "ざ"), ("zu", "ず"), ("ze", "ぜ"), ("zo", "ぞ"), ("zi", "じ"),
    ("da", "だ"), ("di", "ぢ"), ("du", "づ"), ("de", "で"), ("do", "ど"),
    ("ba", "ば"), ("bi", "び"), ("bu", "ぶ"), ("be", "べ"), ("bo", "ぼ"),
    ("pa", "ぱ"), ("pi", "ぴ"), ("pu", "ぷ"), ("pe", "ぺ"), ("po", "ぽ"),
    ("a", "あ"), ("i", "い"), ("u", "う"), ("e", "え"), ("o", "お"),
    ("n", "ん"),
]


def _normalize(token):
    """ローマ字トークンを小文字化し、記号・長音符を除去。"""
    token = token.strip().lower()
    # 長音記号（macron等）を素の母音へ
    trans = str.maketrans("āīūēōâîûêô", "aiueoaiueo")
    token = token.translate(trans)
    token = token.replace("-", "").replace("'", "").replace("’", "")
    return token


def _convert_token(token):
    """1語（姓 or 名）をひらがな化。返り値 (ひらがな, uncertain)。"""
    key = _normalize(token)
    if not key:
        return "", True
    if key in KNOWN_NAMES:
        return KNOWN_NAMES[key], False

    result = []
    uncertain = False
    i = 0
    n = len(key)
    while i < n:
        # 促音（子音重ね: tt, kk, pp, ss ... "sh"/"ch"前の重ねも）
        if i + 1 < n and key[i] == key[i + 1] and key[i] not in "aeioun":
            result.append("っ")
            i += 1
            continue
        matched = False
        for rom, kana in _ROMAJI_TABLE:
            if key.startswith(rom, i):
                result.append(kana)
                i += len(rom)
                matched = True
                break
        if not matched:
            # 未知の綴り（外国人名など）はそのまま残し、要確認扱い
            result.append(key[i])
            uncertain = True
            i += 1
    # 機械変換した語は長音判定の保証がないため常に「要確認」を推奨
    return "".join(result), True if uncertain else True


def romaji_fullname_to_reading(romaji):
    """本文の1著者ローマ字（"Given Surname" 語順）→ "せい　めい"。

    返り値: (reading, uncertain)
    - romaji が全て大文字（外国人名 例 "LEE SANGYOON"）の場合は変換せず、
      元表記を返して uncertain=True。
    """
    parts = [p for p in romaji.replace("　", " ").split() if p]
    if not parts:
        return "", True

    # 全大文字＝外国人名。ローマ字大文字のまま（Excel慣例 "LEE　SANGYOON"）。
    letters = romaji.replace(" ", "").replace("　", "")
    if letters.isupper():
        return "　".join(parts), True

    # 日本語人名は "名 姓"（Western order）。最後を姓、残りを名とみなす。
    surname = parts[-1]
    given = " ".join(parts[:-1])
    sei, u1 = _convert_token(surname)
    mei, u2 = _convert_token(given)
    reading = f"{sei}　{mei}"
    known = (_normalize(surname) in KNOWN_NAMES) and (_normalize(given) in KNOWN_NAMES)
    return reading, (not known)


if __name__ == "__main__":
    tests = [
        "Fumiyoshi Morikawa", "Juichiro Naoe", "Kenji Fuseya",
        "Koji Kasanuki", "Hiroshige Fujishiro", "LEE SANGYOON",
        "Masami Kashimura",
    ]
    for t in tests:
        r, u = romaji_fullname_to_reading(t)
        print(f"{t:24} -> {r}   {'(要確認)' if u else ''}")
