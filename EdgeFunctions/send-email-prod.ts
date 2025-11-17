import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const handler = async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const emailData = await req.json();
    // Format the email body for better presentation with Arial font
    const formattedBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
          ${emailData.body}
        </div>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
          <p>This email was sent from the Interview Management System.</p>
        </div>
      </div>
    `;
    console.log('Sending email to:', emailData.user_email);
    const response = await fetch('https://admin-northstar-prod.azurewebsites.net/api/sendEmail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_email: emailData.user_email,
        sender_email: "shaurya@skilljourney.in",
        cc_recipients: [],
        bcc_recipients: [],
        subject: "Interview Update",
        body: formattedBody,
        body_type: "HTML"
      })
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('Email API error:', result);
      throw new Error(result.message || 'Failed to send email');
    }
    console.log('Email sent successfully:', result);
    return new Response(JSON.stringify({
      success: true,
      data: result
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error('Error in send-email function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to send email'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
};
serve(handler);
