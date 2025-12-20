const CACHE_NAME = 'bancobet-v4.0'; // Cambiamos versión para forzar actualización

// 1. INSTALACIÓN: El navegador detecta cambio en este archivo e instala esta versión
self.addEventListener('install', (event) => {
    // El skipWaiting es la CLAVE. Obliga al SW a activarse YA, sin esperar.
    self.skipWaiting(); 
});

// 2. ACTIVACIÓN: El nuevo SW toma el control y borra la caché vieja
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    // Borramos TODO lo viejo para que la app baje el código nuevo
                    return caches.delete(cache);
                })
            );
        }).then(() => {
            // "Claim" toma el control de la página inmediatamente
            return self.clients.claim(); 
        })
    );
});

// 3. Notificaciones Push (Tu código original)
self.addEventListener('push', function(event) {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch(e) { console.error(e); }

    const options = {
        body: data.body || 'Tienes una nueva notificación',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        vibrate: [100, 50, 100],
        data: { url: 'https://prismanet.org/index.html' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'BancoBet', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(function(clientList) {
            // Si ya está abierta, la enfoca. Si no, la abre.
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes('index.html') && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('index.html');
        })
    );
});