"""Builds fixtures/test-spot.docx for the Word doc importer. Needs python-docx."""
import io, struct, zlib
from pathlib import Path
from docx import Document
from docx.shared import Inches


def tiny_png():
    # 8x8 solid teal PNG, no Pillow needed
    w = h = 8
    raw = b''.join(b'\x00' + b'\x00\x80\x80' * w for _ in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


doc = Document()
doc.add_heading('ZZ.TEST.fs - Docx Import Fixture', level=1)


def para(*runs, style=None):
    p = doc.add_paragraph(style=style)
    for text, fmt in runs:
        r = p.add_run(text)
        r.bold = 'b' in fmt
        r.italic = 'i' in fmt
    return p


doc.add_heading("Capt. Mike's Notes", level=2)
para(('The canal runs ', ''), ('hard', 'b'), (' on the ', ''), ('east', 'i'), (' tide.', ''))
para(('Fish the seam first.', ''), style='List Bullet')
para(('Then the rips.', ''), style='List Bullet')
doc.add_paragraph().add_run().add_picture(io.BytesIO(tiny_png()), width=Inches(0.5))

doc.add_heading('Step 1 – Historical Analysis', level=2)
para(('Stripers have stacked here every May since the 1990s.', ''))
t = doc.add_table(rows=3, cols=3)
for r, row in enumerate([['Month', 'Species', 'Size'], ['May', 'Striped Bass', '28 in'], ['June', 'Bluefish', '6 lb']]):
    for c, v in enumerate(row):
        t.cell(r, c).text = v

doc.add_heading('Environmental Factors', level=2)
para(('Water temp ', ''), ('58–64°F', 'b'), ('.', ''))
t = doc.add_table(rows=3, cols=2)
for r, (k, v) in enumerate([('Tide', 'Outgoing'), ('Wind', 'SW 10–15'), ('Moon', 'New')]):
    t.cell(r, 0).paragraphs[0].add_run(k).bold = True
    t.cell(r, 1).text = v

doc.add_heading('Step 3 - Observational Factors', level=2)
para(('Watch for birds working the ', ''), ('bait', 'bi'), ('.', ''))
para(('Terns first', ''), style='List Number')
para(('Then gannets', ''), style='List Number')

doc.add_heading('Structure & Approach', level=2)
para(('Approach from down-current.', ''))

doc.add_heading('Gear and Technique™', level=2)
para(('7 ft medium rod, 20 lb braid.', ''))

doc.add_heading('Q&A with Capt. Mike', level=2)
para(('Q: Best tide? ', 'b'), ('A: The last two hours of the ebb.', ''))

doc.add_heading('Tide Notes', level=2)
para(('This heading matches no field.', ''))

out = Path(__file__).with_name('test-spot.docx')
doc.save(out)
print(out)
