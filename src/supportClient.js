import { supabase } from "./authClient.js";

export async function submitSupportMessage({ type, subject, message, email, user, question }) {
  if (!supabase) {
    throw new Error("問い合わせ機能の設定が未完了です。");
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const payload = {
    type,
    subject,
    message,
    contact_email: email || user?.email || null,
    question_id: question?.id ?? null,
    question_pack_id: question?.packId ?? null,
    question_exam_id: question?.examId ?? null,
    question_number: Number.isInteger(question?.questionNumber) ? question.questionNumber : null,
    question_prompt: question?.prompt ?? null,
    page_url: window.location.href,
    user_agent: window.navigator.userAgent,
  };

  const headers = new Headers({ "Content-Type": "application/json" });
  const accessToken = data.session?.access_token;
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch("/api/support", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "問い合わせの送信に失敗しました。");
  }
}
