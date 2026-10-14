# Chat M

Chat unificado de **Twitch + Kick + Starvios** para la tablet, pensado para usarlo mientras transmites.

## Qué hace

- Lee los chats de Twitch, Kick y Starvios en una sola lista
  (borde morado = Twitch, verde = Kick, amarillo = Starvios).
- Emotes (Twitch y Kick), insignias (STREAMER / MOD / VIP / SUB), avisos de subs, raids y donaciones de Starvies.
- Resalta los mensajes que te mencionan.
- Toca el nombre de una plataforma arriba para ocultarla o mostrarla.
- Toca un mensaje para **responder, mencionar, borrar, dar timeout o banear** (por ahora solo en Twitch).
- Mantiene la pantalla de la tablet encendida.

Pendiente: responder y moderar en Kick y en Starvios.

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
2 segundos. Si Starvios cambia su web, esta parte podría dejar de funcionar
hasta actualizarla.

## Kick: si no se detecta el chat

Kick a veces bloquea la detección automática. En ese caso:

1. En cualquier navegador abre `https://kick.com/api/v2/channels/TU_CANAL`.
2. Busca `"chatroom":{"id":12345678` y copia ese número.
3. Pégalo en ⚙ Ajustes → Avanzado → *ID del chatroom de Kick*.
