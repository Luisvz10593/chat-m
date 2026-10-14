# Chat M

Chat unificado de **Twitch + Kick + Starvios** para la tablet, pensado para usarlo mientras transmites.

## Qué hace

- Lee los chats de Twitch, Kick y Starvios en una sola lista
  (borde morado = Twitch, verde = Kick, amarillo = Starvios).
- Emotes (Twitch y Kick), insignias (STREAMER / MOD / VIP / SUB), avisos de subs, raids y donaciones de Starvies.
- Resalta los mensajes que te mencionan.
- **Varios canales por plataforma:** en ⚙ escríbelos separados por coma
  (`canal1, canal2`). Con una sola cuenta por plataforma moderas todos los canales
  donde esa cuenta sea dueña o moderadora.
- Arriba hay un botón por canal: tócalo para ocultarlo o mostrarlo.
- Cuando hay varios canales, cada mensaje muestra `#canal` y el selector para escribir
  te deja elegir plataforma y canal.
- Toca un mensaje para **responder, mencionar, borrar, dar timeout o banear** en su plataforma.
- Escribe en cualquier plataforma donde iniciaste sesión (selector junto al campo de texto).
- **Todos:** en el selector para escribir, envía el mismo mensaje a todos los canales a la vez.
- Los mensajes se ordenan por la hora en que se escribieron, sin importar la plataforma.
- **Eventos destacados:**
  - Twitch: subs, renovaciones, regalos, raids, anuncios y bits (por el chat), más
    **follows** (tu canal y donde eres moderador) y **canjes de puntos** (tu canal),
    que necesitan haber iniciado sesión con Twitch.
  - Starvios: subs, regalos, raids, recompensas, donaciones de Starvies, TTS y confeti.
  - Kick: su API pública no da eventos (solo los manda a un servidor por webhooks),
    así que por ahora no aparecen.
- **🎬 Directo:** cambia título, categoría y tags de tu directo en una plataforma o en
  varias a la vez. Tiene 12 categorías favoritas (búscalas y toca ☆) y las 3 recientes:
  tocar una cambia la categoría al momento. Starvios no permite tags.
- Mantiene la pantalla de la tablet encendida.

> **Privacidad:** los Client ID, el Client Secret de Kick y las sesiones se guardan
> **solo en el dispositivo** donde los escribes (no están en el código ni en GitHub).
> La contraseña de Starvios no se guarda nunca: solo se usa para iniciar sesión.

---

## 1. Probarla en la PC

Haz clic derecho en `servidor.ps1` → **Ejecutar con PowerShell**
(no necesita Python). O desde una terminal en esta carpeta:

```
powershell -ExecutionPolicy Bypass -File servidor.ps1
```

Luego entra a <http://localhost:8080>. Toca ⚙ y escribe tus canales.
Para leer el chat no hace falta iniciar sesión.

## 2. Registrar la app en Twitch (para escribir y moderar)

1. Entra a <https://dev.twitch.tv/console/apps> con tu cuenta de Twitch.
2. **Register Your Application**:
   - **Name:** `Chat M Luis` (cualquier nombre único).
   - **OAuth Redirect URLs:** la URL exacta que aparece en ⚙ Ajustes. Puedes agregar varias:
     - `http://localhost:8080/` (para probar en la PC)
     - `https://TU_USUARIO.github.io/chat-m/` (la de la tablet, paso 3)
   - **Category:** Chat Bot · **Client Type:** Public.
3. Copia el **Client ID** y pégalo en ⚙ Ajustes → *Client ID*.
4. Toca **Iniciar sesión** y acepta los permisos.

> Para que funcionen borrar, timeout y ban, la cuenta con la que inicias sesión
> debe ser el dueño del canal o moderador.

## 2b. Registrar la app en Kick (para escribir y moderar en Kick)

1. En kick.com entra a tu perfil → **Settings → Developer** y crea una app.
2. **Redirect URL:** la misma URL que aparece en ⚙ Ajustes
   (`https://luisvz10593.github.io/chat-m/`, y `http://localhost:8080/` si pruebas en la PC).
3. Activa los permisos: **Read user info**, **Read channel info**, **Write channel info**
   (para 🎬 Directo), **Write to chat**, **Moderation: ban users** y
   **Moderation: manage chat messages**.
4. Copia el **Client ID** y el **Client Secret** y pégalos **en la tablet**, en
   ⚙ Ajustes → Cuenta de Kick. Toca **Iniciar sesión**.

## 2c. Iniciar sesión en Starvios

En ⚙ Ajustes → Cuenta de Starvios escribe tu correo y contraseña de Starvios y toca
**Iniciar sesión**. Solo funciona con cuentas de correo y contraseña (no con
inicio de sesión de Google u otras redes). Para moderar, tu cuenta debe ser la
dueña del canal o moderadora.

## 3. Publicarla para la tablet (GitHub Pages, gratis)

1. Crea un repositorio en GitHub llamado `chat-m` y sube los archivos de esta carpeta.
2. En el repositorio: **Settings → Pages → Branch: main / root → Save**.
3. En un minuto queda en `https://TU_USUARIO.github.io/chat-m/`.
4. Agrega esa URL a las *OAuth Redirect URLs* de tu app de Twitch (paso 2).
5. En la tablet, abre la URL con Chrome → menú ⋮ → **Agregar a pantalla de inicio**.

Nota: los ajustes se guardan en cada navegador, así que en la tablet hay que
configurarlos una vez.

## Cómo lee el chat de Kick

Kick retiró su conexión pública en tiempo real (Pusher), y la nueva solo acepta
conexiones desde kick.com. Por eso Chat M pide los últimos 25 mensajes cada
2 segundos. En chats muy rápidos (más de ~12 mensajes por segundo) se pueden
saltar algunos; en un canal normal no pasa. Los mensajes que borra un moderador
se tachan unos segundos después.

## Cómo lee el chat de Starvios

Starvios no tiene API documentada. Chat M usa los mismos datos públicos que
usa su página web (la tabla de mensajes del directo), consultándolos cada
2 segundos. Para escribir y moderar usa las mismas funciones que su web
(`send_live_message`, `moderate_chat_user`). Si Starvios cambia su web, esta
parte podría dejar de funcionar hasta actualizarla.

## Kick: si no se detecta el chat

Kick a veces bloquea la detección automática. En ese caso:

1. En cualquier navegador abre `https://kick.com/api/v2/channels/TU_CANAL`.
2. Busca `"chatroom":{"id":12345678` y copia ese número.
3. Pégalo en ⚙ Ajustes → Avanzado → *ID del chatroom de Kick*.
