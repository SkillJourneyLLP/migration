import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const generateOTP = ()=>{
  return Math.floor(100000 + Math.random() * 900000).toString();
};
const handler = async (req)=>{
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { email, name } = await req.json();
    if (!email || !name) {
      return new Response(JSON.stringify({
        error: "Email and name are required"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    // Clean up expired OTPs first
    await supabase.rpc('cleanup_expired_otps');
    // Check if there's already a valid OTP for this email
    const { data: existingOTP } = await supabase.from('otps').select('*').eq('email', email).eq('verified', false).gt('expires_at', new Date().toISOString()).order('created_at', {
      ascending: false
    }).limit(1).maybeSingle();
    if (existingOTP) {
      console.log(`Valid OTP already exists for email ${email}, resending same OTP`);
      // Resend the existing OTP
      const emailResponse = await resend.emails.send({
        from: "Interview System <noreply@notifications.ikshvaku-innovations.in>",
        to: [
          email
        ],
        subject: "Your Application OTP - Shaurya Interviews",
        html: `
          <h1>Welcome ${name}!</h1>
          <p>Your One-Time Password (OTP) for completing your application is:</p>
          <h2 style="font-size: 32px; font-weight: bold; color: #2563eb; text-align: center; margin: 20px 0; padding: 20px; background: #f3f4f6; border-radius: 8px;">${existingOTP.otp}</h2>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this OTP, please ignore this email.</p>
          <br>
          <p style="color: #6b7280; font-size: 12px; margin-bottom: 0;">
              This is an automated message. Please do not reply to this email.
          </p>
          <p>Best regards,<br>Shaurya Interviews Team</p>
        `
      });
      if (emailResponse.error) {
        console.error("Error sending email:", emailResponse.error);
        return new Response(JSON.stringify({
          error: "Failed to send OTP email"
        }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }
      return new Response(JSON.stringify({
        success: true,
        message: "OTP sent successfully to your email"
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    // Store OTP in database
    const { error: insertError } = await supabase.from('otps').insert({
      email,
      otp,
      expires_at: expiresAt.toISOString(),
      verified: false
    });
    if (insertError) {
      console.error('Error storing OTP:', insertError);
      return new Response(JSON.stringify({
        error: "Failed to generate OTP"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    console.log(`Generated OTP ${otp} for email ${email}, expires at ${expiresAt}`);
    // Send email with OTP
    const emailResponse = await resend.emails.send({
      from: "Interview System <noreply@notifications.ikshvaku-innovations.in>",
      to: [
        email
      ],
      subject: "Your Application OTP - Shaurya Interviews",
      html: `
        <h1>Welcome ${name}!</h1>
        <p>Your One-Time Password (OTP) for completing your application is:</p>
        <h2 style="font-size: 32px; font-weight: bold; color: #2563eb; text-align: center; margin: 20px 0; padding: 20px; background: #f3f4f6; border-radius: 8px;">${otp}</h2>
        <p>This OTP will expire in 10 minutes.</p>
        <p>If you didn't request this OTP, please ignore this email.</p>
        <br>
        <p>Best regards,<br>Shaurya Interviews Team</p>
      `
    });
    console.log("Email sent successfully:", emailResponse);
    if (emailResponse.error) {
      console.error("Error sending email:", emailResponse.error);
      return new Response(JSON.stringify({
        error: "Failed to send OTP email"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    return new Response(JSON.stringify({
      success: true,
      message: "OTP sent successfully to your email"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error("Error in send-otp function:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
};
serve(handler);
