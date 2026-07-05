# Timer systemd — backfill RPPC Tijuana

Unidades para poblar `folio_real` en `catalogos.padron_2026` de forma automática.

## Instalación rápida

```bash
cd /opt/catastro_tijuana_api
sudo sed 's/\r$//' deploy/systemd/catastro-rppc-backfill.service | sudo tee /etc/systemd/system/catastro-rppc-backfill.service > /dev/null
sudo sed 's/\r$//' deploy/systemd/catastro-rppc-backfill.timer   | sudo tee /etc/systemd/system/catastro-rppc-backfill.timer   > /dev/null
sudo cp deploy/systemd/env.rppc-backfill.example .env.rppc-backfill 2>/dev/null || true
sudo systemctl daemon-reload
sudo systemctl enable --now catastro-rppc-backfill.timer
```

O: `sudo ./deploy/systemd/install.sh` (desde la raíz del repo, con `chmod +x`).

## Operación

| Comando | Efecto |
|---------|--------|
| `systemctl list-timers catastro-rppc-backfill.timer` | Próxima ejecución |
| `sudo systemctl start --no-block catastro-rppc-backfill.service` | Un lote ahora (no bloquea SSH) |
| `sudo journalctl -u catastro-rppc-backfill -f` | Log en vivo |

**Requisitos:** cookie RPPC en `.runtime/rppc_cookie.txt`, API/BD accesibles, `scripts/rppc_backfill_masivo_tijuana.py` y `services/rppc_backfill_masivo.py` desplegados.

Ver también la sección *Backfill masivo folio_real* en el `README.md` de la raíz del repo.
