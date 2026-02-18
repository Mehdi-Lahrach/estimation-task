/**
 * PROCESS MAP DATA — Green Zone Vehicle Access Permit (Estimation Task)
 *
 * Context: Prolific participants completed a FICTIONAL government application
 * as part of a behavioral experiment. They role-played as a resident of Newland
 * and were given 6 fictional documents in an on-screen side panel.
 *
 * This process map describes what those participants actually experienced.
 *
 * Data model:
 * - Steps carry actionTypes directly (the tags describe what the step involves)
 * - hiddenActions only appear when there is genuinely hidden important work
 *   that is NOT obvious from the step name (e.g., needing to cross-reference
 *   documents, dealing with validation errors, complex cognitive work)
 * - Decision points and error loops are modeled explicitly
 * - No anchoring: no suggestedRange on estimation blocks
 *
 * Estimation happens at the STEP level, grouped into estimation blocks per phase.
 */

const PROCESS_MAP = {
  title: 'Green Zone Vehicle Access Permit',
  subtitle: 'Experimental procedure completed by Prolific participants',
  description: 'A fictional online government application completed by Prolific participants as part of a behavioral experiment. Participants role-played as a resident of Newland applying for a vehicle access permit to enter restricted low-emission zones. Six fictional documents were provided in an on-screen side panel. The entire procedure was completed online, in one sitting.',

  // Context block — shown to estimators so they understand the setup
  experimentContext: {
    setting: 'Online experiment on Prolific',
    rolePlay: 'Participants role-played as a fictional resident of Newland',
    documents: '6 fictional documents provided in a side panel on screen (driving license, vehicle registration, insurance certificate, technical inspection report, electricity bill, water bill)',
    interaction: 'Participants had to open documents in the side panel and copy specific information into form fields',
    validation: 'The form had real-time validation — errors appeared immediately if a field was in the wrong format',
    completion: 'The entire procedure was completed online, in one sitting, on a computer',
  },

  phases: [
    // ================================================================
    // PHASE 1: UNDERSTANDING THE TASK
    // ================================================================
    {
      id: 'understanding',
      name: 'Understanding the Task',
      shortName: 'Task Intro',
      color: '#2B8A3E',
      icon: '1',
      description: 'Reading the research consent form, understanding the role-play scenario, reviewing the instructions, and confirming understanding before starting the application.',
      richDescription: 'Before starting the application, participants had to read a research consent form and agree to participate. They were then shown a briefing page explaining that they would role-play as a fictional resident of Newland, and that 6 fictional documents would be provided in a side panel. They were told to enter information only from these documents (not their own personal details). Finally, they had to confirm their understanding via a checkbox before the application began.',

      estimationBlocks: [
        {
          id: 'understanding_task',
          label: 'Understanding the task',
          prompt: 'How long do you think it took participants, on average, to read the consent form, understand the role-play scenario and instructions, review the available documents, and confirm their understanding?',
          stepsIncluded: ['1.1', '1.2', '1.3', '1.4'],
        },
      ],

      steps: [
        {
          id: '1.1',
          name: 'Read the research consent form and agree to participate',
          actionTypes: ['Information: Reading', 'Decision: Choosing'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [],
        },
        {
          id: '1.2',
          name: 'Read the role-play scenario and task instructions',
          actionTypes: ['Information: Reading', 'Information: Comprehending'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Understand what "role-play as a fictional resident" means and what is expected', type: 'Information: Comprehending', visibility: 'hidden' },
            { description: 'Process that personal information must NOT be entered — only fictional document data', type: 'Information: Comprehending', visibility: 'hidden' },
          ],
        },
        {
          id: '1.3',
          name: 'Review the 6 fictional documents in the side panel',
          actionTypes: ['Information: Reading', 'Information: Searching'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Figure out how to open and navigate documents in the side panel', type: 'Information: Searching', visibility: 'hidden' },
            { description: 'Get an overview of what information each document contains', type: 'Information: Reading', visibility: 'hidden' },
          ],
        },
        {
          id: '1.4',
          name: 'Confirm understanding of the instructions (checkbox)',
          actionTypes: ['Documentation: Form-filling'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [],
        },
      ],
    },

    // ================================================================
    // PHASE 2: APPLICANT DETAILS
    // ================================================================
    {
      id: 'applicant_details',
      name: 'Applicant Details',
      shortName: 'Details',
      color: '#1864AB',
      icon: '2',
      description: 'Entering the fictional applicant\'s personal details — name, date of birth, and national ID number — by looking up information in the driving license document.',
      richDescription: 'In this section, participants saw a form asking for the applicant\'s personal details. They had to open the fictional driving license document in the side panel and copy information from it into the form. The name fields were straightforward, but the National ID number required a specific format (ID-XXXXXX) — participants had to find the correct number on the document and enter it in exactly the right format. If the format was wrong, a validation error appeared immediately and they had to correct it before continuing.',

      estimationBlocks: [
        {
          id: 'entering_personal_details',
          label: 'Entering personal details',
          prompt: 'How long do you think it took participants, on average, to open the driving license document, find the relevant information, and fill in the name, date of birth, and national ID number (in the required ID-XXXXXX format)?',
          stepsIncluded: ['2.1', '2.2', '2.3'],
        },
      ],

      steps: [
        {
          id: '2.1',
          name: 'Enter the applicant\'s full legal name (first and last name)',
          actionTypes: ['Documentation: Form-filling'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Open the driving license in the side panel and find the name', type: 'Information: Searching', visibility: 'hidden' },
          ],
        },
        {
          id: '2.2',
          name: 'Enter the applicant\'s date of birth',
          actionTypes: ['Documentation: Form-filling'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Find the date of birth on the driving license document', type: 'Information: Searching', visibility: 'hidden' },
          ],
        },
        {
          id: '2.3',
          name: 'Enter the National ID number in the required format (ID-XXXXXX)',
          actionTypes: ['Documentation: Form-filling', 'Information: Searching'],
          visibility: 'documented',
          errorLoop: { condition: 'Format does not match ID-XXXXXX', target: 'self' },
          externalDeps: [],
          hiddenActions: [
            { description: 'Find the National ID number on the driving license — it is not labelled as "National ID"', type: 'Information: Searching', visibility: 'hidden' },
            { description: 'Understand the ID-XXXXXX format requirement and what to substitute', type: 'Information: Comprehending', visibility: 'hidden' },
            { description: 'If validation error: re-read the format hint, correct the entry, and try again', type: 'Monitoring: Error-correcting', visibility: 'hidden' },
          ],
        },
      ],
    },

    // ================================================================
    // PHASE 3: ELIGIBILITY ASSESSMENT
    // ================================================================
    {
      id: 'eligibility',
      name: 'Eligibility Assessment',
      shortName: 'Eligibility',
      color: '#E67700',
      icon: '3',
      description: 'Reading complex eligibility rules, cross-referencing them with the fictional documents, making an eligibility decision, and selecting the correct supporting documents.',
      richDescription: 'This was the most cognitively demanding section. Participants first had to read a full page of eligibility rules covering 4 categories: general prerequisites (valid insurance), automatically authorised vehicles (electric, hydrogen, 30+ years old, disability), ineligible vehicles (registered on or after 1 January 2018), and vehicles required to apply (registered before 2018). They then had to evaluate whether the fictional applicant was eligible by cross-referencing these rules with multiple documents. After making their yes/no eligibility decision, they had to select which documents to upload as evidence of eligibility, and separately select a proof-of-residence document.',

      estimationBlocks: [
        {
          id: 'reading_eligibility',
          label: 'Reading and assessing eligibility',
          prompt: 'How long do you think it took participants, on average, to read the full page of eligibility rules (general prerequisites, automatically authorised categories, ineligible vehicles, and vehicles required to apply), cross-reference them with the fictional documents, and make an eligibility decision (yes or no)?',
          stepsIncluded: ['3.1', '3.2', '3.3'],
        },
        {
          id: 'selecting_documents',
          label: 'Selecting supporting documents',
          prompt: 'How long do you think it took participants, on average, to figure out which documents to select as evidence of eligibility (from a list of all 6 documents), and separately select a proof-of-residence document?',
          stepsIncluded: ['3.4', '3.5'],
        },
      ],

      steps: [
        {
          id: '3.1',
          name: 'Read the detailed eligibility criteria (4 rule categories on one page)',
          actionTypes: ['Information: Reading', 'Information: Comprehending'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Re-read sections that are unclear or use complex legal language', type: 'Information: Reading', visibility: 'hidden' },
            { description: 'Try to memorize the key criteria (insurance validity, registration date cutoff, fuel types)', type: 'Information: Comprehending', visibility: 'hidden' },
          ],
        },
        {
          id: '3.2',
          name: 'Evaluate whether the fictional applicant meets the eligibility requirements',
          actionTypes: ['Decision: Evaluating', 'Information: Searching'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Open multiple documents to check: insurance validity, registration date, fuel type, vehicle age', type: 'Information: Searching', visibility: 'hidden' },
            { description: 'Cross-reference each eligibility criterion against the specific document data', type: 'Decision: Evaluating', visibility: 'hidden' },
            { description: 'Determine which category the vehicle falls into (auto-authorised, ineligible, or required to apply)', type: 'Decision: Evaluating', visibility: 'hidden' },
          ],
        },
        {
          id: '3.3',
          name: 'Select the eligibility answer: "Yes — eligible" or "No — not eligible"',
          actionTypes: ['Decision: Choosing'],
          visibility: 'documented',
          isDecisionPoint: true,
          decisionOptions: ['Yes — eligible', 'No — not eligible'],
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [],
        },
        {
          id: '3.4',
          name: 'Select supporting documents for eligibility (checkboxes from list of 6 documents)',
          actionTypes: ['Documentation: Form-filling', 'Decision: Evaluating'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Re-read the eligibility rules to determine which documents prove compliance', type: 'Information: Reading', visibility: 'hidden' },
            { description: 'Decide which documents are relevant vs. irrelevant (not all 6 apply)', type: 'Decision: Evaluating', visibility: 'hidden' },
          ],
        },
        {
          id: '3.5',
          name: 'Select proof of residence document (radio choice from list of 6 documents)',
          actionTypes: ['Documentation: Form-filling', 'Decision: Evaluating'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Determine which documents qualify as proof of residence (must show address, issued within 3 months)', type: 'Decision: Evaluating', visibility: 'hidden' },
          ],
        },
      ],
    },

    // ================================================================
    // PHASE 4: VEHICLE INFORMATION
    // ================================================================
    {
      id: 'vehicle_info',
      name: 'Vehicle Information',
      shortName: 'Vehicle',
      color: '#862E9C',
      icon: '4',
      description: 'Entering vehicle details across 4 separate form pages — registration number, ownership type, vehicle category, fuel type, and environmental classification — all looked up from vehicle documents.',
      richDescription: 'This section was spread across 4 separate form pages, each asking for different vehicle details. On the first page, participants entered the vehicle registration number (in the specific format AB-123-CD, with validation) and selected the ownership type. On the second page, they chose a vehicle category from a list of 8 options (M1, M2, M3, N1, N2, N3, T, or "not indicated"). On the third page, they selected a fuel type from 10 options. On the fourth page, they selected an environmental classification from 7 options. For each page, participants had to open the relevant vehicle document in the side panel, find the correct information, and match it to the listed options.',

      estimationBlocks: [
        {
          id: 'entering_vehicle_info',
          label: 'Entering all vehicle information',
          prompt: 'How long do you think it took participants, on average, to fill in all vehicle details across 4 form pages? This included entering the registration number (specific format: AB-123-CD, with validation), selecting ownership type, choosing from lists of 8 vehicle categories, 10 fuel types, and 7 environmental classifications — all by finding the correct information in the vehicle documents.',
          stepsIncluded: ['4.1', '4.2', '4.3', '4.4'],
        },
      ],

      steps: [
        {
          id: '4.1',
          name: 'Enter the vehicle registration number (format: AB-123-CD) and select ownership type',
          actionTypes: ['Documentation: Form-filling', 'Information: Searching'],
          visibility: 'documented',
          errorLoop: { condition: 'Format does not match AB-123-CD', target: 'self' },
          externalDeps: [],
          hiddenActions: [
            { description: 'Open the vehicle registration certificate in the side panel and find the registration number', type: 'Information: Searching', visibility: 'hidden' },
            { description: 'Understand the AB-123-CD format pattern (2 letters, dash, 3 digits, dash, 2 letters)', type: 'Information: Comprehending', visibility: 'hidden' },
            { description: 'If validation error: re-check the format, correct any mistakes, and try again', type: 'Monitoring: Error-correcting', visibility: 'hidden' },
          ],
        },
        {
          id: '4.2',
          name: 'Select vehicle category from a list of 8 options',
          actionTypes: ['Documentation: Form-filling', 'Decision: Evaluating'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Find the vehicle category code on the registration certificate', type: 'Information: Searching', visibility: 'hidden' },
            { description: 'Match the code on the document to the 8 listed options (M1, M2, M3, N1, N2, N3, T, not indicated)', type: 'Decision: Evaluating', visibility: 'hidden' },
          ],
        },
        {
          id: '4.3',
          name: 'Select fuel type from a list of 10 options',
          actionTypes: ['Documentation: Form-filling', 'Decision: Evaluating'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Find the fuel type on the registration certificate', type: 'Information: Searching', visibility: 'hidden' },
            { description: 'Match it to one of the 10 options listed (petrol, diesel, LPG, electric, hybrid variants, etc.)', type: 'Decision: Evaluating', visibility: 'hidden' },
          ],
        },
        {
          id: '4.4',
          name: 'Select environmental classification from a list of 7 options',
          actionTypes: ['Documentation: Form-filling', 'Decision: Evaluating'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [
            { description: 'Find the environmental class on the technical inspection report or registration certificate', type: 'Information: Searching', visibility: 'hidden' },
            { description: 'Match it to one of the 7 options listed (Green A/B/C, Transitional, Not indicated, Z-1, Z-3)', type: 'Decision: Evaluating', visibility: 'hidden' },
          ],
        },
      ],
    },

    // ================================================================
    // PHASE 5: DECLARATION & SUBMISSION
    // ================================================================
    {
      id: 'declaration',
      name: 'Declaration & Submission',
      shortName: 'Submit',
      color: '#C92A2A',
      icon: '5',
      description: 'Reading the legal declaration, confirming the accuracy of all information, and submitting the completed application.',
      richDescription: 'In the final section, participants saw a legal-style declaration warning that false declarations could lead to rejection and "further administrative consequences". They had to tick two mandatory checkboxes: one confirming the information was complete and accurate, and one acknowledging the consequences of a false declaration. After ticking both, they clicked the "Submit application" button and received a confirmation page with a reference number.',

      estimationBlocks: [
        {
          id: 'declaration_submit',
          label: 'Reviewing and submitting',
          prompt: 'How long do you think it took participants, on average, to read the legal declaration (warning about false declarations and consequences), confirm both required checkboxes, and click "Submit application"?',
          stepsIncluded: ['5.1', '5.2', '5.3'],
        },
      ],

      steps: [
        {
          id: '5.1',
          name: 'Read the declaration of accuracy and consequences warning',
          actionTypes: ['Information: Reading', 'Information: Comprehending'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [],
        },
        {
          id: '5.2',
          name: 'Confirm both required declarations (two checkboxes)',
          actionTypes: ['Documentation: Form-filling'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [],
        },
        {
          id: '5.3',
          name: 'Click "Submit application"',
          actionTypes: ['Documentation: Submitting'],
          visibility: 'documented',
          errorLoop: null,
          externalDeps: [],
          hiddenActions: [],
        },
      ],
    },
  ],
};

// ============================================================
// SUMMARY STATISTICS
// ============================================================

const PROCESS_STATS = (() => {
  let totalSteps = 0;
  let totalHiddenActions = 0;
  let totalEstimationBlocks = 0;
  let stepsWithErrorLoops = 0;
  let decisionPoints = 0;

  PROCESS_MAP.phases.forEach(phase => {
    totalSteps += phase.steps.length;
    totalEstimationBlocks += phase.estimationBlocks.length;
    phase.steps.forEach(step => {
      totalHiddenActions += step.hiddenActions.length;
      if (step.errorLoop) stepsWithErrorLoops++;
      if (step.isDecisionPoint) decisionPoints++;
    });
  });

  return {
    totalPhases: PROCESS_MAP.phases.length,
    totalSteps,
    totalHiddenActions,
    totalEstimationBlocks,
    stepsWithErrorLoops,
    decisionPoints,
  };
})();

// ============================================================
// ACTION TYPE COLOURS (for display)
// ============================================================

const ACTION_TYPE_COLORS = {
  'Information: Reading':       { bg: '#e3f2fd', text: '#1565c0' },
  'Information: Searching':     { bg: '#e3f2fd', text: '#1565c0' },
  'Information: Comprehending': { bg: '#e8eaf6', text: '#283593' },
  'Decision: Evaluating':       { bg: '#fff3e0', text: '#e65100' },
  'Decision: Choosing':         { bg: '#fff3e0', text: '#e65100' },
  'Documentation: Form-filling':{ bg: '#e8f5e9', text: '#2e7d32' },
  'Documentation: Submitting':  { bg: '#e8f5e9', text: '#2e7d32' },
  'Monitoring: Error-correcting':{ bg: '#fce4ec', text: '#c62828' },
};
