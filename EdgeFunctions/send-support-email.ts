import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { recipients, subject, body } = await req.json();
    console.log('Sending email to recipients:', recipients);
    console.log('Subject:', subject);
    // Send email to each recipient
    const emailPromises = recipients.map(async (recipient)=>{
      const response = await fetch('https://admin-northstar-prod.azurewebsites.net/api/sendEmail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_email: recipient,
          sender_email: 'admin@skilljourney.in',
          cc_recipients: [],
          bcc_recipients: [],
          subject: subject,
          body: `<p>${body.replace(/\n/g, '<br>')}</p>`,
          body_type: 'HTML'
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send email to ${recipient}: ${errorText}`);
      }
      return await response.json();
    });
    const results = await Promise.all(emailPromises);
    console.log('Email sending results:', results);
    return new Response(JSON.stringify({
      success: true,
      message: `Successfully sent email to ${recipients.length} recipient(s)`,
      results
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in send-support-email function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
