
let io = null;

const setIo = (socketInstance) => {
  io = socketInstance;
};

const getIo = () => {
  if (!io) {
    throw new Error("Socket.io is not initialized");
  }

  return io;
};

const emitToUser = (userId, event, data) => {
  if (!io) {
    console.error("Socket.io is not initialized");
    return;
  }

  io.to(String(userId)).emit(event, data);
};

export { emitToUser, getIo, setIo };
