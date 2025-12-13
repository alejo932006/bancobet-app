self.addEventListener('push', function(event) {
    const data = event.data.json();
    
    const options = {
        body: data.body,
        icon: 'icon-192.png', // Asegúrate que este ícono exista
        badge: 'icon-192.png',
        vibrate: [100, 50, 100], // Patrón de vibración tipo mensaje
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    // Al tocar la notificación, abre la app
    event.waitUntil(
        clients.openWindow('https://prismanet.org/index.html')
    );
});