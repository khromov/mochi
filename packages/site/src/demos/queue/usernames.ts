const names = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'mallory', 'olivia', 'peggy', 'trent', 'victor', 'wendy'];

export function randomUsername(): string {
  return names[Math.floor(Math.random() * names.length)] ?? 'alice';
}
