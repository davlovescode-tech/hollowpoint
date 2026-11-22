/* Optional network config for room-code multiplayer.
   STUN works for most home networks. Strict mobile/corporate NATs need a TURN relay:
   add one here (e.g. from a free tier of a TURN provider) and rooms will connect everywhere. */
window.HP_CFG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
    // { urls: "turn:YOUR_TURN_HOST:3478", username: "user", credential: "pass" }
  ]
};
