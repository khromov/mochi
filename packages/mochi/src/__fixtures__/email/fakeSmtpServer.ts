// Minimal plaintext SMTP server for tests. Speaks just enough of the protocol
// for nodemailer to deliver a message: greets 220, answers EHLO/MAIL/RCPT with
// 250, 354 to DATA, 250 after the terminating dot, 221 to QUIT. It advertises
// no STARTTLS/AUTH, so nodemailer stays plaintext with `secure: false`.

export interface FakeSmtpMessage {
  from: string;
  to: string[];
  /** Raw DATA payload: headers + body, dot-unstuffed, CRLF line endings. */
  data: string;
}

export interface FakeSmtpServer {
  port: number;
  messages: FakeSmtpMessage[];
  close(): void;
}

interface ConnState {
  buffer: string;
  reading: boolean;
  from: string;
  to: string[];
  data: string;
}

function extractAddr(line: string): string {
  const m = line.match(/<([^>]*)>/);
  if (m) {
    return m[1] ?? '';
  }
  return line.split(':')[1]?.trim() ?? '';
}

function handleLine(socket: Bun.Socket<ConnState>, state: ConnState, line: string, messages: FakeSmtpMessage[]): void {
  if (state.reading) {
    if (line === '.') {
      state.reading = false;
      messages.push({ from: state.from, to: [...state.to], data: state.data });
      state.data = '';
      socket.write('250 2.0.0 OK queued\r\n');
      return;
    }
    // Undo SMTP dot-stuffing: a data line starting with '.' had one prepended.
    state.data += (line.startsWith('.') ? line.slice(1) : line) + '\r\n';
    return;
  }

  const upper = line.toUpperCase();
  if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
    socket.write('250 localhost\r\n');
  } else if (upper.startsWith('MAIL FROM')) {
    state.from = extractAddr(line);
    socket.write('250 2.1.0 OK\r\n');
  } else if (upper.startsWith('RCPT TO')) {
    state.to.push(extractAddr(line));
    socket.write('250 2.1.5 OK\r\n');
  } else if (upper === 'DATA') {
    state.reading = true;
    socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
  } else if (upper.startsWith('QUIT')) {
    socket.write('221 2.0.0 Bye\r\n');
    socket.end();
  } else {
    socket.write('250 OK\r\n');
  }
}

export function startFakeSmtpServer(): FakeSmtpServer {
  const messages: FakeSmtpMessage[] = [];
  const listener = Bun.listen<ConnState>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: '', reading: false, from: '', to: [], data: '' };
        socket.write('220 localhost ESMTP fake\r\n');
      },
      data(socket, chunk) {
        const state = socket.data;
        state.buffer += chunk.toString();
        let idx: number;
        while ((idx = state.buffer.indexOf('\r\n')) !== -1) {
          const line = state.buffer.slice(0, idx);
          state.buffer = state.buffer.slice(idx + 2);
          handleLine(socket, state, line, messages);
        }
      },
    },
  });

  return {
    port: listener.port,
    messages,
    close: () => listener.stop(true),
  };
}
