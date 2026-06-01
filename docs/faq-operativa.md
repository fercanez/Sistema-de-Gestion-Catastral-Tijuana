# FAQ operativa

## Propósito

Este documento reúne preguntas frecuentes de operación, soporte y administración básica del Sistema de Gestión Catastral BC.

Su objetivo es ofrecer respuestas rápidas a dudas recurrentes sobre:

- disponibilidad del sistema
- servicios principales
- rutas importantes
- cambios en producción
- respaldos
- incidencias
- documentación y mantenimiento

Está pensado como referencia práctica para operación diaria y soporte inicial.

---

## 1. ¿Cómo sé si la API principal está funcionando?

Revisa el servicio:

```bash
systemctl status catastro-api --no-pager
```

Debe aparecer como:

```text
active (running)
```

También puedes revisar el proceso y el puerto:

```bash
ps aux | grep uvicorn
ss -tulpn | grep 9000
```

---

## 2. ¿Cuál es el servicio principal del sistema?

El servicio principal identificado para la API es:

```text
catastro-api.service
```

---

## 3. ¿Dónde está desplegada la API?

Ruta observada del despliegue:

```text
/opt/catastro_api
```

---

## 4. ¿Con qué corre la API?

La ejecución observada fue con:

- Python
- entorno virtual
- Uvicorn
- `systemd`

Comando equivalente observado:

```bash
/opt/catastro_api/venv/bin/python3 /opt/catastro_api/venv/bin/uvicorn main:app --host 0.0.0.0 --port 9000
```

---

## 5. ¿Cuál es el puerto principal de la API?

Se observó corriendo en el puerto:

```text
9000
```

---

## 6. ¿Cómo reinicio la API?

```bash
systemctl restart catastro-api
```

Y luego valida:

```bash
systemctl status catastro-api --no-pager
```

---

## 7. ¿Cómo reviso los logs recientes?

```bash
journalctl -u catastro-api -n 100 --no-pager
```

Para seguimiento en vivo:

```bash
journalctl -u catastro-api -f
```

---

## 8. ¿Qué endpoints conviene probar después de un cambio?

Los mínimos críticos identificados son:

```text
GET /padron/{clave}/ficha
GET /expediente/{clave}/historial
GET /expediente/{clave}/documentos
GET /predios/{clave}/propietarios
```

---

## 9. ¿Qué hago si el sistema no responde?

Primero revisa:

```bash
systemctl status catastro-api --no-pager
journalctl -u catastro-api -n 100 --no-pager
```

Luego revisa proceso y puerto:

```bash
ps aux | grep uvicorn
ss -tulpn | grep 9000
```

Si el servicio está caído, intenta reiniciarlo:

```bash
systemctl restart catastro-api
```

Si no levanta o vuelve a caer, escala con logs.

---

## 10. ¿Qué hago si solo falla una clave catastral?

Eso puede indicar un problema puntual de datos, no necesariamente del sistema completo.

Recomendación:
- probar otra clave conocida
- registrar la clave afectada
- revisar si ficha, historial, propietarios o documentos fallan solo en ese caso
- escalar como posible problema de datos

---

## 11. ¿Qué hago si no aparecen documentos?

Revisa si el problema es:
- que no se listan
- que se listan pero no abren
- que falta físicamente el archivo

Ruta importante:

```text
/var/www/catastro/documentos
```

También revisa:
- logs del backend
- permisos de archivos
- si el problema afecta a uno o varios expedientes

---

## 12. ¿Qué hago si no aparecen propietarios?

Primero valida si:
- el problema afecta solo una clave o varias
- la ficha sí carga
- otros predios sí muestran propietarios

Endpoint clave:

```text
GET /predios/{clave}/propietarios
```

Si solo falla un caso, probablemente sea tema de datos.  
Si falla masivamente, puede ser problema del backend o consulta asociada.

---

## 13. ¿Qué hago si el historial no carga?

Probar:

```text
GET /expediente/{clave}/historial
```

Luego:
- revisar logs
- comparar con otra clave
- revisar si el problema es general o puntual
- escalar si coincide con cambios recientes en DB o vistas

---

## 14. ¿Qué significa `Invalid HTTP request received` en los logs?

Generalmente significa tráfico externo no deseado o ruido de internet:
- bots
- scanners
- probes

No suele indicar por sí mismo una falla del sistema.

Solo preocúpate más si:
- hay muchísimos eventos
- coinciden con degradación del servicio
- hay señales de abuso o saturación

---

## 15. ¿Qué es GeoNode y me afecta si falla?

GeoNode es un componente geoespacial separado que también está activo en el servidor.

Servicios observados:

```text
geonode.service
geonode-celery.service
```

Si falla, puede afectar funciones geoespaciales complementarias, pero no necesariamente toda la API catastral.

---

## 16. ¿Cómo reviso si GeoNode está activo?

```bash
systemctl status geonode --no-pager
systemctl status geonode-celery --no-pager
```

---

## 17. ¿QCarta sigue siendo parte del sistema?

No.  
QCarta fue identificado como un componente separado y fue retirado del servidor sin afectar la API principal ni GeoNode.

---

## 18. ¿Dónde están los documentos y archivos web?

Rutas observadas:

```text
/var/www/catastro
/var/www/catastro/documentos
```

Además existe el docroot general:

```text
/var/www/html
```

---

## 19. ¿Dónde está GeoNode en el servidor?

Ruta fuente observada:

```text
/root/src/geonode
```

---

## 20. ¿Dónde está la configuración sensible?

La aplicación utiliza variables de entorno, probablemente cargadas desde `.env`.

Variables observadas:
- `SECRET_KEY`
- `JWT_ALGORITHM`
- `ACCESS_TOKEN_EXPIRE_MINUTES`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

---

## 21. ¿Puedo cambiar `.env` directamente en producción?

Solo con mucho cuidado.

Antes de cambiar `.env`:
- haz respaldo
- confirma el motivo
- entiende el impacto
- valida después del cambio

Nunca conviene editarlo improvisadamente.

---

## 22. ¿Qué respaldo mínimo debo hacer antes de un cambio?

Al menos:

- código desplegado:
```text
/opt/catastro_api
```

- configuración:
```text
/opt/catastro_api/.env
```

- servicio:
```text
/etc/systemd/system/catastro-api.service
```

Y si el cambio afecta datos:
- respaldo de PostgreSQL

---

## 23. ¿Cómo respaldo rápido el código desplegado?

Ejemplo:

```bash
cp -a /opt/catastro_api /root/backups/catastro_api_$(date +%Y%m%d_%H%M%S)
```

---

## 24. ¿Cómo respaldo `.env`?

```bash
cp -a /opt/catastro_api/.env /root/backups/.env_catastro_$(date +%Y%m%d_%H%M%S) 2>/dev/null
```

---

## 25. ¿Cómo respaldo el servicio systemd?

```bash
cp -a /etc/systemd/system/catastro-api.service /root/backups/catastro-api.service_$(date +%Y%m%d_%H%M%S)
```

---

## 26. ¿Cómo sé si necesito rollback?

Considera rollback si:
- el sistema dejó de funcionar tras un cambio reciente
- el servicio no levanta por una modificación nueva
- fallan endpoints críticos después del despliegue
- no puedes corregir rápidamente el problema
- existe respaldo listo para restauración

---

## 27. ¿Qué debo revisar después de un despliegue?

Como mínimo:

- estado del servicio
- logs
- ficha predial
- historial
- documentos
- propietarios
- visor si aplica

---

## 28. ¿Dónde registro cambios importantes?

En:

```text
docs/bitacora-cambios.md
```

---

## 29. ¿Dónde registro trabajo técnico pendiente?

En:

```text
docs/backlog-tecnico.md
```

y también puedes complementar con:

```text
docs/pendientes-tecnicos.md
```

---

## 30. ¿Qué documento uso antes de un cambio en producción?

El principal es:

```text
docs/checklist-produccion.md
```

---

## 31. ¿Qué documento uso si tengo que respaldar o restaurar?

Usa:

```text
docs/respaldo-y-recuperacion.md
```

---

## 32. ¿Qué documento uso para entender el servidor?

Usa:

```text
docs/operacion-servidor.md
```

---

## 33. ¿Qué documento uso para soporte inicial?

Usa:

```text
docs/manual-soporte.md
```

y también:

```text
docs/incidentes-comunes.md
```

---

## 34. ¿Qué documento uso para operación cotidiana?

Usa:

```text
docs/manual-operacion-diaria.md
```

---

## 35. ¿Qué documento uso para tareas administrativas?

Usa:

```text
docs/manual-admin.md
```

---

## 36. ¿Qué documento resume módulos, responsabilidades y riesgos?

Usa:

```text
docs/matriz-modulos.md
```

---

## 37. ¿Qué documento describe permisos y roles?

Usa:

```text
docs/permisos-y-roles.md
```

---

## 38. ¿Qué documento describe los endpoints?

Usa:

```text
docs/endpoints.md
```

---

## 39. ¿Qué documento describe el modelo de datos?

Usa:

```text
docs/modelo-de-datos.md
```

---

## 40. ¿Qué documento debo leer si soy nuevo en el proyecto?

Orden sugerido:

1. `README.md`
2. `docs/arquitectura-tecnica.md`
3. `docs/matriz-modulos.md`
4. `docs/endpoints.md`
5. `docs/manual-operacion-diaria.md`
6. `docs/manual-admin.md`

---

## Resumen

Esta FAQ está pensada para responder rápido dudas comunes sobre:

- servicios
- rutas
- respaldos
- incidencias
- cambios
- documentación

Debe crecer con el tiempo conforme aparezcan nuevas preguntas frecuentes de operación real.