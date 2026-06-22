/* ============================================================
   TAXI-LINK — Connexion à la base partagée Supabase
   (clé "publishable" = publique, sans danger côté navigateur)
   ============================================================ */
const SUPABASE_URL = "https://flcfacoowzrvkrhgjmzp.supabase.co";
const SUPABASE_KEY = "sb_publishable_DKL4s9OB6P28rPYmn5LBGA_64RN0WM7";

// Client global (la lib est chargée via CDN avant ce fichier)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
