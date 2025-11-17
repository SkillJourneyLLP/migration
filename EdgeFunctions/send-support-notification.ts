import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
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
    // Optional authorization header
    const authHeader = req.headers.get('authorization');
    console.log('Authorization header present:', !!authHeader);
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let requesterEmail = null;
    let requesterUserId = null;
    if (authHeader) {
      try {
        // Extract the JWT token and try to resolve user, but don't fail if invalid
        const token = authHeader.replace('Bearer ', '');
        console.log('Token extracted, length:', token.length);
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        console.log('User verification result:', {
          hasUser: !!user,
          userEmail: user?.email,
          error: userError?.message
        });
        if (user && !userError) {
          requesterEmail = user.email ?? null;
          requesterUserId = user.id;
        } else {
          console.warn('Proceeding without authenticated user (invalid or missing user)');
        }
      } catch (e) {
        console.error('User verification failed:', e);
        console.warn('Proceeding without authenticated user due to token error');
      }
    } else {
      console.warn('No authorization header; proceeding as public request');
    }
    const requestData = await req.json();
    if (!requesterEmail && requestData.email) {
      requesterEmail = requestData.email;
    }
    console.log('Processing support notification for email:', requesterEmail);
    console.log('Organization ID from request:', requestData.organizationId);
    // Get user's organization_id from users table (by id if available, else by email, or use provided organizationId)
    let userData = null;
    let userDataError = null;
    let organizationId = requestData.organizationId || null;
    // Only lookup user if we don't have organizationId from request
    if (!organizationId) {
      if (requesterUserId) {
        const { data, error } = await supabase.from('users').select('organization_id, email').eq('id', requesterUserId).single();
        userData = data;
        userDataError = error;
        organizationId = userData?.organization_id || null;
      } else if (requesterEmail) {
        const { data, error } = await supabase.from('users').select('organization_id, email').eq('email', requesterEmail).single();
        userData = data;
        userDataError = error;
        organizationId = userData?.organization_id || null;
      }
      if (userDataError) {
        console.error('Error fetching user data:', userDataError);
      // Continue without organization if lookup fails
      }
    }
    // Get primary admins for the organization
    let primaryAdminEmails = [];
    console.log('Looking up admins with organization_id:', organizationId);
    if (organizationId) {
      const { data: admins, error: adminsError } = await supabase.from('users').select('email, role, organization_id').eq('organization_id', organizationId).eq('role', 'primaryadmin');
      console.log('Admin query result:', {
        adminsFound: admins?.length || 0,
        admins: admins,
        error: adminsError
      });
      if (adminsError) {
        console.error('Error fetching admins:', adminsError);
      } else {
        primaryAdminEmails = admins?.map((admin)=>admin.email).filter(Boolean) || [];
        console.log('Primary admin emails extracted:', primaryAdminEmails);
      }
    } else {
      console.warn('No organization_id found for user, cannot fetch org admins');
    }
    // Prepare email body
    const emailBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
          <h2 style="color: #2563eb; margin-top: 0;">New Support Ticket Submitted</h2>
          
          <div style="background: white; padding: 15px; border-radius: 6px; margin: 15px 0;">
            <h3 style="margin-top: 0; color: #1f2937;">Ticket Details</h3>
            <p><strong>Type:</strong> ${requestData.ticketType}</p>
            <p><strong>Submitted By:</strong> ${requesterEmail || (userData?.email ?? 'Unknown')}</p>
            <p><strong>Description:</strong></p>
            <p style="white-space: pre-wrap; background: #f9fafb; padding: 10px; border-radius: 4px;">${requestData.description}</p>
          </div>
          
          <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
            Please address this support ticket at your earliest convenience.
          </p>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
          <p>This email was sent from the Interview Management System.</p>
        </div>
      </div>
    `;
    // Prepare recipients list (admin@skilljourney.in + primary admins)
    const allRecipients = [
      'admin@skilljourney.in',
      ...primaryAdminEmails
    ];
    const uniqueRecipients = [
      ...new Set(allRecipients)
    ]; // Remove duplicates
    console.log('All recipients before deduplication:', allRecipients);
    console.log('Unique recipients after deduplication:', uniqueRecipients);
    console.log('Primary recipient (TO):', uniqueRecipients[0]);
    console.log('CC recipients:', uniqueRecipients.slice(1));
    console.log('Full email payload:', {
      user_email: uniqueRecipients[0],
      sender_email: "admin@skilljourney.in",
      cc_recipients: uniqueRecipients.slice(1),
      subject: `New Support Ticket: ${requestData.ticketType}`
    });
    // Send email using the external API
    const emailResponse = await fetch('https://admin-northstar-prod.azurewebsites.net/api/sendEmail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_email: uniqueRecipients[0],
        sender_email: "admin@skilljourney.in",
        cc_recipients: uniqueRecipients.slice(1),
        bcc_recipients: [],
        subject: `New Support Ticket: ${requestData.ticketType}`,
        body: emailBody,
        body_type: "HTML"
      })
    });
    console.log('Email API response status:', emailResponse.status);
    const emailResult = await emailResponse.json();
    console.log('Email API response:', emailResult);
    if (!emailResponse.ok) {
      console.error('Email API error:', emailResult);
      // Do not fail the entire request if email fails
      return new Response(JSON.stringify({
        success: true,
        message: 'Ticket created; email notification could not be sent',
        emailSent: false,
        emailStatus: emailResponse.status,
        emailResult
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    console.log('Email sent successfully:', emailResult);
    return new Response(JSON.stringify({
      success: true,
      message: 'Support notification sent successfully',
      emailsSent: uniqueRecipients.length
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error('Error in send-support-notification function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to send support notification'
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
