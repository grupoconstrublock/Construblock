/* Adaptador: conecta la app con tu Apps Script (Google Sheets). No necesitas modificar este archivo. */
(function () {
  var URL_API = (window.CONFIG_BLOQUERA || {}).urlApi || '';
  var CLAVE_LS = 'bloquera-clave';
  var clave = null; try { clave = localStorage.getItem(CLAVE_LS); } catch (e) {}

  function obtenerClave() {
    if (clave) return Promise.resolve(clave);
    var c = window.prompt('Escribe la clave de tu bloquera (la que pusiste en el Apps Script):');
    if (!c) return Promise.reject(new Error('Sin clave'));
    clave = c.trim(); try { localStorage.setItem(CLAVE_LS, clave); } catch (e) {}
    return Promise.resolve(clave);
  }

  function api(body, intento) {
    if (!URL_API || /PEGA_AQUI/.test(URL_API)) return Promise.reject(new Error('Falta pegar la dirección de tu Apps Script en el archivo config.js'));
    var usada;
    return obtenerClave().then(function (c) {
      usada = c;
      return fetch(URL_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ clave: c }, body)) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) return j;
      if (j.error === 'clave' && (intento || 0) < 3) {
        if (clave === usada) {
          clave = null; try { localStorage.removeItem(CLAVE_LS); } catch (e) {}
          window.alert('La clave no es correcta. Inténtalo de nuevo.');
        }
        return api(body, (intento || 0) + 1);
      }
      throw new Error(j.error === 'clave' ? 'Clave incorrecta' : (j.error || 'Error del servidor'));
    });
  }

  var cache = {}, subs = {}, urlDe = {}, idDe = {}, pedidos = {};
  function resolver(d) {
    var o = d;
    for (var k in d) {
      var v = d[k];
      if (typeof v === 'string' && v.indexOf('archivo:') === 0) {
        var id = v.slice(8);
        if (urlDe[id]) { if (o === d) o = Object.assign({}, d); o[k] = urlDe[id]; } else cargarArchivo(id);
      }
    }
    return o;
  }
  function desresolver(d) {
    var o = Object.assign({}, d);
    for (var k in o) { var v = o[k]; if (typeof v === 'string' && idDe[v]) o[k] = 'archivo:' + idDe[v]; }
    return o;
  }
  function cargarArchivo(id) {
    if (pedidos[id]) return; pedidos[id] = 1;
    api({ accion: 'archivo', id: id }).then(function (j) {
      if (j.url) { urlDe[id] = j.url; idDe[j.url] = id; Object.keys(subs).forEach(emitir); }
    }).catch(function () {});
  }
  function foto(col) {
    var docs = (cache[col] || []).map(function (r) {
      return { id: r.id, exists: true, data: function () { return resolver(r.data); }, metadata: { fromCache: false, hasPendingWrites: false } };
    });
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: {} };
  }
  function emitir(col) { (subs[col] || []).forEach(function (fn) { try { fn(foto(col)); } catch (e) { console.error(e); } }); }
  function avisar(msg) { var b = document.getElementById('banner'); if (b) { b.textContent = msg; b.hidden = !msg; } }

  var cargando = null;
  function refrescar() {
    if (cargando) return cargando;
    cargando = api({ accion: 'todo' }).then(function (j) {
      avisar('');
      Object.keys(j.datos).forEach(function (c) { cache[c] = j.datos[c]; emitir(c); });
    }).catch(function (e) {
      avisar('No se pudo conectar con tus datos: ' + e.message + '.');
      Object.keys(subs).forEach(function (c) { if (!cache[c]) { cache[c] = []; emitir(c); } });
    }).then(function () { cargando = null; });
    return cargando;
  }
  setInterval(function () { if (document.visibilityState === 'visible') refrescar(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refrescar(); });

  function local(col, fn) { cache[col] = cache[col] || []; fn(cache[col]); emitir(col); }
  function enviar(body) { return api(body).catch(function (e) { refrescar(); throw e; }); }
  var nuevoId = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };

  function docRef(col, id) {
    return {
      id: id, path: col + '/' + id,
      get: function () { var r = (cache[col] || []).filter(function (x) { return x.id === id; })[0]; return Promise.resolve({ id: id, exists: !!r, data: function () { return r && resolver(r.data); } }); },
      set: function (data) { var d = desresolver(data); local(col, function (a) { var r = a.filter(function (x) { return x.id === id; })[0]; if (r) r.data = d; else a.push({ id: id, data: d }); }); return enviar({ accion: 'poner', col: col, id: id, data: d }).then(function () {}); },
      update: function (data) { var d = desresolver(data); local(col, function (a) { var r = a.filter(function (x) { return x.id === id; })[0]; if (r) r.data = Object.assign({}, r.data, d); }); return enviar({ accion: 'actualizar', col: col, id: id, data: d }).then(function () {}); },
      delete: function () { local(col, function (a) { for (var i = a.length - 1; i >= 0; i--) if (a[i].id === id) a.splice(i, 1); }); return enviar({ accion: 'borrar', col: col, id: id }).then(function () {}); }
    };
  }
  function colRef(col) {
    var ref = {
      path: col,
      doc: function (id) { return docRef(col, id || nuevoId()); },
      add: function (data) { var id = nuevoId(), d = desresolver(data); local(col, function (a) { a.push({ id: id, data: d }); }); return enviar({ accion: 'agregar', col: col, id: id, data: d }).then(function () { return docRef(col, id); }); },
      onSnapshot: function (next) { (subs[col] = subs[col] || []).push(next); if (cache[col]) setTimeout(function () { next(foto(col)); }, 0); else refrescar(); return function () { subs[col] = subs[col].filter(function (f) { return f !== next; }); }; },
      get: function () { return refrescar().then(function () { return foto(col); }); },
      where: function () { return ref; }, orderBy: function () { return ref; }, limit: function () { return ref; }
    };
    return ref;
  }
  var db = { collection: colRef, doc: function (p) { var s = p.split('/'); return docRef(s[0], s[1]); } };

  var assets = {
    upload: function (blob) {
      return new Promise(function (ok, no) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = no; fr.readAsDataURL(blob); })
        .then(function (dataUrl) {
          var b64 = String(dataUrl).split(',')[1];
          return api({ accion: 'subirArchivo', tipo: blob.type || 'image/png', base64: b64 }).then(function (j) {
            urlDe[j.id] = dataUrl; idDe[dataUrl] = j.id;
            return { id: j.id, url: dataUrl, sizeBytes: blob.size, contentType: blob.type };
          });
        });
    },
    list: function () { return Promise.resolve({ assets: [], usage: {} }); },
    delete: function (id) { if (!id || String(id).length < 10) return Promise.resolve({ deleted: false }); return api({ accion: 'borrarArchivo', id: id }).then(function () { return { deleted: true }; }); }
  };

  var downloads = {
    save: function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data]);
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = o.filename || 'archivo'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
      return Promise.resolve();
    }
  };

  window.claude = { use: function (n) { return Promise.resolve(n === 'db' ? db : n === 'assets' ? assets : n === 'downloads' ? downloads : null); } };
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
})();
