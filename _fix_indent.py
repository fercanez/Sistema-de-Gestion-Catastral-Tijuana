path = r"E:\servidor catastro\servidor fcnarqnodo.hopto.org\routers\movimientos.py"
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

start = next(i for i, l in enumerate(lines) if '@router.post("/movimientos/{movimiento_id}/aplicar")' in l)
nombre_if = next(i for i in range(start, len(lines)) if 'if tipo in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]' in lines[i])
ip_line = next(i for i in range(nombre_if, len(lines)) if lines[i].strip().startswith("ip = request.client.host"))
except_line = next(i for i in range(ip_line, len(lines)) if lines[i].strip() == "except HTTPException:")

for i in range(nombre_if + 1, ip_line):
    if lines[i].strip():
        lines[i] = "    " + lines[i]

for i in range(ip_line, except_line):
    if lines[i].strip():
        if lines[i].startswith("            ") and not lines[i].startswith("                "):
            lines[i] = "    " + lines[i]

with open(path, "w", encoding="utf-8") as f:
    f.writelines(lines)
print("OK", nombre_if + 1, ip_line + 1, except_line + 1)
