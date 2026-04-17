import { env } from "../config/env.js";

export const   sendOtpEmail = async (email: string, otp: string) => {
  const apiKey = env.BREVO_API_KEY;

  if (!apiKey) {
    console.error("BREVO_API_KEY is not set in environment.");
    return false;
  }

  const payload = {
    sender: {
      name: "Task Management System",
      email: env.BREVO_SENDER_EMAIL
    },
    to: [
      {
        email: email
      }
    ],
    subject: "Your Login Verification Code",
    htmlContent: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-top: 4px solid #3366ff; border-radius: 8px; max-width: 500px; margin: auto;">
        <h2 style="color: #333;">Your Verification Code</h2>
        <p style="font-size: 16px; color: #555;">Hello,</p>
        <p style="font-size: 16px; color: #555;">To complete your login, please use the following code:</p>
        <div style="background: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; color: #3366ff; letter-spacing: 5px; border-radius: 4px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="font-size: 14px; color: #888;">This code will expire in 5 minutes.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #aaa;">If you did not request this code, please ignore this email.</p>
      </div>
    `
  };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Brevo API Error:", errorData);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to send OTP email:", error);
    return false;
  }
};
