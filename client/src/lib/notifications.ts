export const requestNotificationPermission = async () => {
  if (!("Notification" in window)) {
    console.log("This browser does not support desktop notification");
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  }

  return false;
};

export const sendNotification = (title: string, options?: NotificationOptions) => {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, {
      icon: "/logo.png", // Make sure this exists or use a generic icon
      badge: "/logo.png",
      ...options,
    });
  }
};
