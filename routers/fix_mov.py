p = r"E:\servidor catastro\servidor fcnarqnodo.hopto.org\routers\movimientos.py"
a = r"E:\servidor catastro\servidor fcnarqnodo.hopto.org\routers\_aplicar_only.py"
d = open(p, "rb").read()
marker = b"def actualizar_estado_aplicado"
start = d.find(marker)
end = d.find(b"return cur.fetchone()", start)
end = d.find(b"\n", end) + 1
head = d[:end]
tail = open(a, "rb").read()
open(p, "wb").write(head + b"\n" + tail)
print("ok", len(head), len(tail))
