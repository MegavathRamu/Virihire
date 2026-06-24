"""Self-hosted OCR + field extraction + fuzzy name matching.

We are the provider: EasyOCR reads the image, then our rules pull structured
fields (name, Aadhaar/PAN number). No third-party API.
"""
import io
import re
import base64
import difflib
import numpy as np
from PIL import Image

_reader = None


def get_reader():
    global _reader
    if _reader is None:
        import easyocr  # imported lazily so the module loads fast
        _reader = easyocr.Reader(["en"], gpu=False)
    return _reader


def decode_image(image_b64: str) -> np.ndarray:
    # Accept raw base64 or a data URL ("data:image/...;base64,XXXX").
    if "," in image_b64 and image_b64.strip().startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]
    raw = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return np.array(img)


def ocr_lines(image_b64: str):
    img = decode_image(image_b64)
    results = get_reader().readtext(img, detail=0)  # list of strings
    return [r.strip() for r in results if r and r.strip()]


# --- field extraction ---------------------------------------------------------
_NAME_STOPWORDS = {
    "GOVERNMENT", "INDIA", "UNIQUE", "IDENTIFICATION", "AUTHORITY", "AADHAAR", "MALE",
    "FEMALE", "DOB", "YEAR", "BIRTH", "ADDRESS", "INCOME", "TAX", "DEPARTMENT",
    "PERMANENT", "ACCOUNT", "NUMBER", "CARD", "FATHER", "NAME", "SIGNATURE",
    "GOVT", "OF", "REPUBLIC", "MARKS", "BOARD", "CERTIFICATE", "SECONDARY",
    # marksheet / certificate noise
    "SCHOOL", "COLLEGE", "EDUCATION", "HIGH", "STATE", "MEDIUM", "DISTRICT",
    "GRADE", "GRADES", "SUBJECT", "ROLL", "EXAMINATION", "REGULAR", "CANDIDATE",
    "CERTIFIED", "GUARDIAN", "ENGLISH", "TELUGU", "HINDI", "PUPIL", "MOTHER",
}

# Labels that precede the holder/candidate name on certificates & letters.
_CAND_LABEL = ("CERTIF", "NAME OF CANDIDATE", "NAME OF THE CANDIDATE", "STUDENT", "CANDIDATE", "PUPIL")
_NOT_CAND = ("FATHER", "MOTHER", "SCHOOL", "BOARD", "GUARDIAN")
_LABEL_WORDS = ("CERTIFIED", "CERTIFIFD", "THAT", "NAME", "OF", "THE", "CANDIDATE", "STUDENT", "PUPIL", "THIS", "IS", "TO")

AADHAAR_RE = re.compile(r"\b(\d{4}\s?\d{4}\s?\d{4})\b")
PAN_RE = re.compile(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b")


def _looks_like_name(line: str) -> bool:
    letters = re.sub(r"[^A-Za-z ]", "", line).strip()
    if len(letters) < 3:
        return False
    words = [w for w in letters.split() if w]
    if not (1 <= len(words) <= 4):
        return False
    if any(w.upper() in _NAME_STOPWORDS for w in words):
        return False
    # mostly alphabetic line
    return len(letters) >= 0.6 * len(line)


DOB_RE = re.compile(r"\d{2}/\d{2}/\d{4}")


def _name_candidates(lines):
    out = []
    for i, ln in enumerate(lines):
        if _looks_like_name(ln):
            out.append((i, re.sub(r"[^A-Za-z ]", "", ln).strip()))
    return out


def find_name(doc_type: str, lines):
    cands = _name_candidates(lines)
    if not cands:
        return ""
    if doc_type in ("aadhaar_front", "aadhaar_back"):
        # On Aadhaar the holder's name sits just ABOVE the DOB / gender line.
        anchor = None
        for i, ln in enumerate(lines):
            u = ln.upper()
            if "DOB" in u or "MALE" in u or "FEMALE" in u or "YEAR OF BIRTH" in u or DOB_RE.search(ln):
                anchor = i
                break
        if anchor is not None:
            above = [c for c in cands if c[0] < anchor]
            if above:
                return above[-1][1]  # nearest plausible name above the DOB line
        # fallback: prefer the multi-word / longest candidate over short noise
        cands.sort(key=lambda c: (len(c[1].split()), len(c[1])), reverse=True)
        return cands[0][1]

    if doc_type == "pan":
        # Holder name is the first real name line AFTER the header/PAN-number block
        # (skips "INCOME TAX / Account Number / HFPPM…"; the line below it is the
        # father's name, so we take the FIRST one after the header).
        header_end = -1
        for i, ln in enumerate(lines):
            u = re.sub(r"[^A-Za-z0-9]", "", ln).upper()
            is_header = any(k in ln.upper() for k in (
                "INCOME", "TAX", "DEPART", "GOVT", "INDIA", "PERMANENT", "ACCOUNT", "NUMBER", "CARD",
            ))
            is_panlike = bool(re.match(r"^[A-Z]{5}.{4}[A-Z]$", u))
            if is_header or is_panlike:
                header_end = i
        for j in range(header_end + 1, len(lines)):
            if _looks_like_name(lines[j]):
                return re.sub(r"[^A-Za-z ]", "", lines[j]).strip()
        # fallback: best multi-word candidate
        cands.sort(key=lambda c: (len(c[1].split()), len(c[1])), reverse=True)
        return cands[0][1]

    if doc_type in ("tenth", "twelfth", "employment"):
        return _marksheet_name(lines, cands)

    # other: prefer the multi-word / longest candidate over noise
    cands.sort(key=lambda c: (len(c[1].split()), len(c[1])), reverse=True)
    return cands[0][1]


def _marksheet_name(lines, cands):
    # Anchor on the candidate-name label ("CERTIFIED THAT" / "NAME OF CANDIDATE" /
    # "This is to certify that …"), skipping FATHER/MOTHER/SCHOOL lines.
    for i, ln in enumerate(lines):
        u = ln.upper()
        if any(b in u for b in _NOT_CAND):
            continue
        if any(lbl in u for lbl in _CAND_LABEL):
            # name may be on the same line after the label words
            same = re.sub(r"[^A-Za-z ]", " ", ln)
            for w in _LABEL_WORDS:
                same = re.sub(rf"\b{w}\b", "", same, flags=re.IGNORECASE)
            same = re.sub(r"\s+", " ", same).strip()
            if _looks_like_name(same):
                return same
            # otherwise the next plausible name line
            for j in range(i + 1, min(i + 4, len(lines))):
                if _looks_like_name(lines[j]):
                    return re.sub(r"[^A-Za-z ]", "", lines[j]).strip()
    # fallback: best multi-word candidate (school/board terms are now stopwords)
    if cands:
        cands.sort(key=lambda c: (len(c[1].split()), len(c[1])), reverse=True)
        return cands[0][1]
    return ""


def extract_fields(doc_type: str, lines):
    text = " ".join(lines)
    upper = text.upper()
    number = ""

    if doc_type in ("aadhaar_front", "aadhaar_back"):
        m = AADHAAR_RE.search(text)
        number = re.sub(r"\s", "", m.group(1)) if m else ""
    elif doc_type == "pan":
        m = PAN_RE.search(upper)
        number = m.group(1) if m else ""
        if not number:
            # OCR often confuses digits in the middle 4 (S->5, O->0, ...). Recover.
            trans = str.maketrans({"S": "5", "O": "0", "I": "1", "Z": "2", "B": "8", "G": "6", "Q": "0", "D": "0"})
            for ln in lines:
                u = re.sub(r"[^A-Za-z0-9]", "", ln).upper()
                m2 = re.match(r"^([A-Z]{5})(.{4})([A-Z])$", u)
                if m2:
                    mid = m2.group(2).translate(trans)
                    if mid.isdigit():
                        number = m2.group(1) + mid + m2.group(3)
                        break

    name = find_name(doc_type, lines)
    return name, number


# --- name matching ------------------------------------------------------------
def normalize_name(name: str) -> str:
    n = re.sub(r"[^A-Za-z ]", " ", (name or "")).upper()
    return " ".join(sorted(t for t in n.split() if t))


def name_similarity(a: str, b: str) -> float:
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    return difflib.SequenceMatcher(None, na, nb).ratio()
