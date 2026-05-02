import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const sendWelcomeEmail = async (email: string, name: string, tempPassword: string) => {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.BREVO_SENDER_EMAIL;

  if (!apiKey || !senderEmail) {
    logger.warn("Brevo credentials not set — welcome email not sent", "mail");
    return false;
  }

  const payload = {
    sender: { name: "Task Management System", email: senderEmail },
    to: [{ email }],
    subject: "Welcome to Task Management — Your Account Details",
    htmlContent: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-top: 4px solid #3366ff; border-radius: 8px; max-width: 500px; margin: auto;">
        <h2 style="color: #333;">Welcome, ${name}!</h2>
        <p style="font-size: 16px; color: #555;">Your account has been created. Use the credentials below to log in:</p>
        <table style="width: 100%; margin: 20px 0;">
          <tr><td style="color: #888; padding: 4px 0;">Email</td><td style="font-weight: bold; color: #333;">${email}</td></tr>
          <tr><td style="color: #888; padding: 4px 0;">Password</td><td style="font-weight: bold; color: #3366ff; letter-spacing: 2px;">${tempPassword}</td></tr>
        </table>
        <p style="font-size: 14px; color: #e53e3e;">Please change your password after your first login.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #aaa;">If you did not expect this email, please contact your administrator.</p>
      </div>
    `,
  };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error("Brevo API error sending welcome email", await response.json(), "mail");
      return false;
    }
    return true;
  } catch (error) {
    logger.error("Failed to send welcome email", error, "mail");
    return false;
  }
};

export const sendPasswordResetEmail = async (email: string, otp: string) => {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.BREVO_SENDER_EMAIL;

  if (!apiKey || !senderEmail) {
    logger.warn("Brevo credentials not set — password reset email not sent", "mail");
    return false;
  }

  const payload = {
    sender: { name: "Task Management System", email: senderEmail },
    to: [{ email }],
    subject: "Password Reset Code",
    htmlContent: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-top: 4px solid #e53e3e; border-radius: 8px; max-width: 500px; margin: auto;">
        <h2 style="color: #333;">Reset Your Password</h2>
        <p style="font-size: 16px; color: #555;">We received a request to reset your password. Use the code below:</p>
        <div style="background: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; color: #e53e3e; letter-spacing: 5px; border-radius: 4px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="font-size: 14px; color: #888;">This code will expire in 5 minutes.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #aaa;">If you did not request a password reset, please ignore this email.</p>
      </div>
    `,
  };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error("Brevo API error sending password reset email", await response.json(), "mail");
      return false;
    }
    return true;
  } catch (error) {
    logger.error("Failed to send password reset email", error, "mail");
    return false;
  }
};

export const sendOtpEmail = async (email: string, otp: string) => {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.BREVO_SENDER_EMAIL;

  if (!apiKey) {
    logger.warn("BREVO_API_KEY is not set — email sending disabled", "mail");
    return false;
  }

  if (!senderEmail) {
    logger.warn("BREVO_SENDER_EMAIL is not set — email sending disabled", "mail");
    return false;
  }

  const payload = {
    sender: {
      name: "Task Management System",
      email: senderEmail
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
      logger.error("Brevo API error", errorData, "mail");
      return false;
    }

    return true;
  } catch (error) {
    logger.error("Failed to send OTP email", error, "mail");
    return false;
  }
};
