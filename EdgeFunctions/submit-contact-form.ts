import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.0";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')
        }
      }
    });
    const { name, phone, email, location, organization, requirement } = await req.json();
    // Validate required fields
    if (!name || !phone || !email || !organization) {
      return new Response(JSON.stringify({
        error: 'Missing required fields'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Insert into enquiries table
    const { data, error } = await supabaseClient.from('enquiries').insert([
      {
        name,
        phone_number: phone,
        email_id: email,
        location: location || null,
        organization_name: organization,
        Requirement: requirement || null,
        status: 'new'
      }
    ]).select().single();
    if (error) {
      console.error('Error inserting enquiry:', error);
      return new Response(JSON.stringify({
        error: 'Failed to submit form'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Contact form submitted successfully:', data.id);
    // Determine recipient based on origin domain
    const origin = req.headers.get('origin') || req.headers.get('referer') || '';
    const isHyraiDomain = origin.toLowerCase().includes('://hyrai.ai') || origin.toLowerCase().includes('://www.hyrai.ai');
    console.log('Request origin:', origin, 'Is hyrai.ai domain:', isHyraiDomain);
    // Send email notification to sales team in the background
    const sendNotificationEmail = async ()=>{
      try {
        const emailBody = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <div style="margin: 0 auto 16px auto;">
                <span style="color: #1e40af; font-size: 36px; font-weight: 800; letter-spacing: -0.5px;">hyr</span><span style="color: #60a5fa; font-size: 36px; font-weight: 800; letter-spacing: -0.5px;">AI</span>
              </div>
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">New Contact Inquiry</h1>
            </div>
            
            <!-- Content -->
            <div style="padding: 40px 30px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                You have received a new contact form submission. Details below:
              </p>
              
              <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; width: 40%;">
                      <strong style="color: #1f2937; font-size: 14px;">Name</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-size: 14px;">
                      ${name}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                      <strong style="color: #1f2937; font-size: 14px;">Email Address</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-size: 14px;">
                      <a href="mailto:${email}" style="color: #2563eb; text-decoration: none;">${email}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                      <strong style="color: #1f2937; font-size: 14px;">Phone Number</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-size: 14px;">
                      <a href="tel:${phone}" style="color: #2563eb; text-decoration: none;">${phone}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; ${location ? 'border-bottom: 1px solid #e5e7eb;' : ''}">
                      <strong style="color: #1f2937; font-size: 14px;">Organization</strong>
                    </td>
                    <td style="padding: 12px 0; ${location ? 'border-bottom: 1px solid #e5e7eb;' : ''} color: #4b5563; font-size: 14px;">
                      ${organization}
                    </td>
                  </tr>
                  ${location ? `
                  <tr>
                    <td style="padding: 12px 0;">
                      <strong style="color: #1f2937; font-size: 14px;">Location</strong>
                    </td>
                    <td style="padding: 12px 0; color: #4b5563; font-size: 14px;">
                      ${location}
                    </td>
                  </tr>
                  ` : ''}
                </table>
              </div>
              
              ${requirement ? `
              <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 20px; border-radius: 4px; margin-bottom: 24px;">
                <h3 style="color: #1e40af; margin: 0 0 12px 0; font-size: 15px; font-weight: 600;">Requirements / Message</h3>
                <p style="color: #1e40af; margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${requirement}</p>
              </div>
              ` : ''}
            </div>
            
            <!-- Footer -->
            <div style="background: #f9fafb; padding: 24px 30px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0;">
                <strong>Submitted:</strong> ${new Date().toLocaleString('en-US', {
          timeZone: 'Asia/Kolkata',
          dateStyle: 'full',
          timeStyle: 'short'
        })} IST
              </p>
              <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0;">
                <strong>Source:</strong> ${origin || 'Unknown'}
              </p>
              <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; margin: 0;">
                  Powered by <strong style="color: #2563eb;">hyrAI</strong> • AI-Powered Hiring Platform
                </p>
              </div>
            </div>
          </div>
        `;
        const emailPayload = {
          user_email: isHyraiDomain ? 'ameya.naik@skilljourney.in' : 'saurabh.deshpande@skilljourney.in',
          sender_email: 'shaurya@skilljourney.in',
          cc_recipients: isHyraiDomain ? [
            'amol.chaudhari@skilljourney.in'
          ] : [],
          bcc_recipients: [],
          subject: 'New Contact Form Submission - hyrAI',
          body: emailBody,
          body_type: 'HTML'
        };
        const emailResponse = await fetch('https://admin-northstar-prod.azurewebsites.net/api/sendEmail', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(emailPayload)
        });
        if (!emailResponse.ok) {
          const errorText = await emailResponse.text();
          console.error('Failed to send notification email:', errorText);
        } else {
          const result = await emailResponse.json();
          console.log('Notification email sent successfully:', result);
        }
      } catch (emailError) {
        console.error('Error sending notification email:', emailError);
      }
    };
    // Send email notification to sales team in the background
    sendNotificationEmail().catch((err)=>console.error('Background email error:', err));
    return new Response(JSON.stringify({
      success: true,
      data
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in submit-contact-form function:', error);
    return new Response(JSON.stringify({
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
