// Reglas de contraseña de Auth (registro, restablecimiento y cambio):
// al menos 8 caracteres, como máximo 72 bytes UTF-8 y ningún carácter NUL.
// Valida en el formulario solo para dar mejor feedback: Auth vuelve a validar siempre.
export function checkPassword(password) {
  if ([...password].length < 8) return 'too_short';
  if (new TextEncoder().encode(password).length > 72) return 'too_long_bytes';
  if (password.includes('\0')) return 'contains_nul';
  return null; // válida
}
