import { supabase } from "./authClient.js";

export async function submitSupportMessage({ type, subject, message, email, user, question }) {
  if (!supabase) {
    throw new Error("問い合わせ機能の設定が未完了です。");
  }

  const payload = {
    type,
    subject,
    message,
    contact_email: email || user?.email || null,
    user_id: user?.id ?? null,
    question_id: question?.id ?? null,
    question_pack_id: question?.packId ?? null,
    question_exam_id: question?.examId ?? null,
    question_number: Number.isInteger(question?.questionNumber) ? question.questionNumber : null,
    question_prompt: question?.prompt ?? null,
    page_url: window.location.href,
    user_agent: window.navigator.userAgent,
  };

  const { error } = await supabase.from("support_messages").insert(payload);
  if (error) throw error;
}
