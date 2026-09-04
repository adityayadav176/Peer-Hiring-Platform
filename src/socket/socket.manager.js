let io = null;

const setIo = (socketId) => {
    io = socketId;
}

const getIo = () => {
    if(!io) {
        throw new Error("Socket.io is not initilized");
    }

    return io;
}

const emitToUser = (userId, event, data) => {
    if(!io) {
        console.error("Socket.io is not initilzed");
        return;
    }

    io.to(String(userId)).emit(event, data);
};

export {
    emitToUser,
    getIo,
    setIo
}

