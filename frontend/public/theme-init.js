// Apply the saved theme before the app bundle loads to avoid a dark flash.
try {
  var savedFamTheme = localStorage.getItem('fam-theme')
  document.documentElement.dataset.theme =
    savedFamTheme === 'paper' || savedFamTheme === 'sketch' ? savedFamTheme : 'dark'
} catch {
  document.documentElement.dataset.theme = 'dark'
}
