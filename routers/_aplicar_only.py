
@router.post("/movimientos/{movimiento_id}/aplicar")
def aplicar_movimiento_padron(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                mov = obtener_movimiento_base(cur, movimiento_id)
                if mov["estado"] == "APLICADO":
                    raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

                tipo = str(mov["tipo_movimiento"] or "").upper()
                clave = mov["clave_catastral"]
                detalles = obtener_detalles_movimiento(cur, movimiento_id)
                if not clave and tipo != "ALTA_CLAVE":
                    raise HTTPException(status_code=400, detail="El movimiento no tiene clave catastral")

                ip = request.client.host if request.client else None
                estado_ant = mov["estado"]

                if tipo in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                    nuevo_nombre = (
                        valor_detalle(detalles, "nombre_propietario")
                        or valor_detalle(detalles, "nombre_completo")
                        or valor_detalle(detalles, "propietario")
                    )
                    if not nuevo_nombre:
                        datos_nuevos = _json_dict(mov.get("datos_nuevos"))
                        nuevo_nombre = (
                            datos_nuevos.get("nombre_propietario")
                            or datos_nuevos.get("nombre_completo")
                            or datos_nuevos.get("propietario")
                        )
                    if tipo == "CAMBIO_TITULARIDAD" and not nuevo_nombre and clave:
                        nuevo_nombre = _aplicar_titularidad_desde_relaciones(cur, clave)
                    if not nuevo_nombre:
                        raise HTTPException(status_code=400, detail="No se encontro titular para aplicar.")

                    cur.execute("SELECT nombre_completo FROM catalogos.padron_2026 WHERE clave_catastral = %s LIMIT 1;", (clave,))
                    anterior = cur.fetchone()
                    if not anterior:
                        raise HTTPException(status_code=404, detail="No se encontro la clave en padron_2026")

                    cur.execute("""
                        UPDATE catalogos.padron_2026 SET nombre_completo = %s
                        WHERE clave_catastral = %s RETURNING clave_catastral, nombre_completo;
                    """, (nuevo_nombre, clave))
                    actualizado = cur.fetchone()

                    rfc_nuevo = valor_detalle(detalles, "rfc")
                    tipo_persona_nuevo = valor_detalle(detalles, "tipo_persona")
                    datos_nuevos_aplica = _json_dict(mov.get("datos_nuevos"))
                    if not rfc_nuevo:
                        rfc_nuevo = datos_nuevos_aplica.get("rfc")
                    if not tipo_persona_nuevo:
                        tipo_persona_nuevo = datos_nuevos_aplica.get("tipo_persona")

                    cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
                    cols_per = columnas_tabla(cur, "catalogos", "personas")
                    if "vigente" in cols_pp:
                        cur.execute("""
                            SELECT pp.id_persona FROM catastro.predio_propietario pp
                            WHERE UPPER(TRIM(pp.clave_catastral::text)) = UPPER(TRIM(%s)) AND pp.vigente = TRUE
                            ORDER BY pp.id_persona DESC LIMIT 1;
                        """, (clave,))
                    else:
                        cur.execute("""
                            SELECT pp.id_persona FROM catastro.predio_propietario pp
                            WHERE UPPER(TRIM(pp.clave_catastral::text)) = UPPER(TRIM(%s))
                            ORDER BY pp.id_persona DESC LIMIT 1;
                        """, (clave,))
                    rel = cur.fetchone()
                    if rel and rel.get("id_persona"):
                        pp_set, pp_params = [], []
                        if rfc_nuevo and "rfc" in cols_pp:
                            pp_set.append("rfc = %s"); pp_params.append(rfc_nuevo)
                        if tipo_persona_nuevo and "tipo_persona" in cols_pp:
                            pp_set.append("tipo_persona = %s"); pp_params.append(tipo_persona_nuevo)
                        if nuevo_nombre and "nombre_completo" in cols_pp:
                            pp_set.append("nombre_completo = %s"); pp_params.append(nuevo_nombre)
                        if pp_set:
                            pp_params.extend([rel["id_persona"], clave])
                            cur.execute(f"UPDATE catastro.predio_propietario SET {', '.join(pp_set)} WHERE id_persona = %s AND UPPER(TRIM(clave_catastral::text)) = UPPER(TRIM(%s));", pp_params)
                        per_set, per_params = [], []
                        if nuevo_nombre and "nombre" in cols_per:
                            per_set.append("nombre = %s"); per_params.append(nuevo_nombre)
                        if rfc_nuevo and "rfc" in cols_per:
                            per_set.append("rfc = %s"); per_params.append(rfc_nuevo)
                        if tipo_persona_nuevo and "tipo_persona" in cols_per:
                            per_set.append("tipo_persona = %s"); per_params.append(tipo_persona_nuevo)
                        if per_set:
                            per_params.append(rel["id_persona"])
                            cur.execute(f"UPDATE catalogos.personas SET {', '.join(per_set)} WHERE id_persona = %s;", per_params)

                    cur.execute("""
                        INSERT INTO catastro.historial_titularidad (
                            clave_catastral, movimiento_id, tipo_evento,
                            nombre_anterior, nombre_nuevo, motivo, usuario_modifica
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s);
                    """, (clave, movimiento_id, tipo, anterior.get("nombre_completo"), nuevo_nombre, mov.get("motivo"), usuario))

                    _registrar_auditoria_aplicar(cur, movimiento_id, clave, "APLICAR_CAMBIO_NOMBRE", estado_ant,
                        "Cambio aplicado a padron_2026.nombre_completo",
                        {"valor_anterior": anterior.get("nombre_completo"), "valor_nuevo": nuevo_nombre}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": "Cambio de nombre aplicado al padron", "movimiento": mov_final, "actualizado": actualizado}

                if tipo in ["CAMBIO_SUPERFICIE", "CAMBIO_CONSTRUCCION", "CAMBIO_USO_SUELO",
                            "CAMBIO_ZONA_HOMOGENEA", "NUMERO_OFICIAL",
                            "ASIGNACION_NUMERO_OFICIAL", "CAMBIO_NUMERO_OFICIAL"]:
                    actualizado = _aplicar_campos_desde_detalles(cur, clave, detalles, mov)
                    _registrar_auditoria_aplicar(cur, movimiento_id, clave, f"APLICAR_{tipo}", estado_ant,
                        f"Cambio aplicado ({tipo})", {"actualizado": _fila_a_dict(actualizado)}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": f"Movimiento {tipo} aplicado al padron", "movimiento": mov_final, "actualizado": actualizado}

                if tipo == "CAMBIO_CLAVE":
                    clave_nueva = mov.get("clave_catastral_nueva") or _valor_desde_movimiento(mov, detalles, "clave_catastral_nueva", "clave_nueva")
                    anterior, clave_nueva = _propagar_clave_en_tablas(cur, clave, clave_nueva)
                    _registrar_auditoria_aplicar(cur, movimiento_id, clave_nueva, "APLICAR_CAMBIO_CLAVE", estado_ant,
                        "Clave actualizada", {"clave_anterior": clave, "clave_nueva": clave_nueva}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": "Cambio de clave aplicado", "movimiento": mov_final}

                if tipo == "BLOQUEO":
                    if not _actualizar_estatus_predio(cur, clave, "BLOQUEADO"):
                        raise HTTPException(status_code=400, detail="No existe columna estatus en predios")
                    _registrar_auditoria_aplicar(cur, movimiento_id, clave, "APLICAR_BLOQUEO", estado_ant, "Predio bloqueado", {"estatus": "BLOQUEADO"}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": "Bloqueo aplicado", "movimiento": mov_final}

                if tipo == "DESBLOQUEO":
                    if not _actualizar_estatus_predio(cur, clave, "ACTIVO"):
                        raise HTTPException(status_code=400, detail="No existe columna estatus en predios")
                    _registrar_auditoria_aplicar(cur, movimiento_id, clave, "APLICAR_DESBLOQUEO", estado_ant, "Predio desbloqueado", {"estatus": "ACTIVO"}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": "Desbloqueo aplicado", "movimiento": mov_final}

                if tipo == "BAJA_CLAVE":
                    row, modo = _aplicar_baja_clave(cur, clave)
                    _registrar_auditoria_aplicar(cur, movimiento_id, clave, "APLICAR_BAJA_CLAVE", estado_ant, f"Baja ({modo})", {"clave": clave}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": "Baja aplicada", "movimiento": mov_final}

                if tipo == "ALTA_CLAVE":
                    actualizado = _aplicar_alta_clave(cur, mov, detalles)
                    clave_alta = actualizado.get("clave_catastral")
                    _registrar_auditoria_aplicar(cur, movimiento_id, clave_alta, "APLICAR_ALTA_CLAVE", estado_ant,
                        "Alta de clave", {"actualizado": _fila_a_dict(actualizado)}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": "Alta aplicada", "movimiento": mov_final, "actualizado": actualizado}

                if tipo == "SUBDIVISION":
                    claves_res = _parse_lista_claves(_valor_desde_movimiento(mov, detalles, "claves_resultantes", "claves_destino") or "")
                    if not claves_res:
                        raise HTTPException(status_code=400, detail="Faltan claves resultantes")
                    n = _registrar_relaciones_prediales(cur, movimiento_id, "SUBDIVISION", clave, claves_res, usuario, detalles)
                    _registrar_auditoria_aplicar(cur, movimiento_id, clave, "APLICAR_SUBDIVISION", estado_ant, f"Subdivisión ({n})", {"claves": claves_res}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": "Subdivisión aplicada", "movimiento": mov_final}

                if tipo == "FUSION":
                    clave_dest = mov.get("clave_catastral_nueva") or _valor_desde_movimiento(mov, detalles, "clave_destino", "clave_catastral_nueva")
                    claves_orig = _parse_lista_claves(_valor_desde_movimiento(mov, detalles, "claves_origen", "claves_a_fusionar") or "")
                    if not clave_dest:
                        raise HTTPException(status_code=400, detail="Falta clave destino")
                    if not claves_orig and clave:
                        claves_orig = [clave]
                    n = sum(_registrar_relaciones_prediales(cur, movimiento_id, "FUSION", co, [clave_dest], usuario, detalles) for co in claves_orig)
                    _registrar_auditoria_aplicar(cur, movimiento_id, clave_dest, "APLICAR_FUSION", estado_ant, f"Fusion ({n})",
                        {"claves_origen": claves_orig, "clave_destino": clave_dest}, usuario, ip)
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return {"ok": True, "mensaje": "Fusion aplicada", "movimiento": mov_final}

                raise HTTPException(status_code=400, detail=f"Tipo {tipo} sin regla de aplicacion.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al aplicar movimiento: {e}")
