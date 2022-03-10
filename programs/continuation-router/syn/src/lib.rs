#![allow(clippy::needless_return)]
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, AttributeArgs, DeriveInput, Ident, Meta, NestedMeta};

#[proc_macro_attribute]
pub fn router_action(args: TokenStream, input: TokenStream) -> TokenStream {
    let args = parse_macro_input!(args as AttributeArgs);
    let mut ast = parse_macro_input!(input as DeriveInput);
    match &mut ast.data {
        syn::Data::Struct(ref mut _struct_data) => {
            // let accounts_name = &Ident::new(format!("{}Accounts", name).as_str(), name.span());
            let name = &ast.ident;
            let action_name = &Ident::new(format!("{}", name).as_str(), name.span());

            let process_impl = match &*args {
                [NestedMeta::Meta(Meta::Path(path))]
                    if path
                        .clone()
                        .segments
                        .into_iter()
                        .any(|s| s.ident == "pass_through") =>
                {
                    quote! {
                        impl<'info> crate::processor::ActionInputOutput<'info> for ActionContext<'_, '_, '_, 'info, #action_name<'info>> {
                            fn input_account(&self) -> &Account<'info, TokenAccount> {
                                &self.action.input
                            }

                            fn output_account(&self) -> &Account<'info, TokenAccount> {
                                &self.action.output
                            }
                        }

                        impl<'info> crate::processor::Processor<'info> for ActionContext<'_, '_, '_, 'info, #action_name<'info>> {
                            fn process_unchecked(
                                &self,
                                amount_in: u64,
                                minimum_amount_out: u64
                            ) -> Result<()> {
                                crate::router_action_processor::process_action(
                                    CpiContext::new(
                                        self.swap_program.clone(),
                                        self.remaining_accounts.to_vec()
                                    ),
                                    Self::TYPE.into(),
                                    amount_in,
                                    minimum_amount_out,
                                )
                            }
                        }
                    }
                }
                _ => quote! {
                    impl<'info> crate::processor::ActionInputOutput<'info> for ActionContext<'_, '_, '_, 'info, #action_name<'info>> {
                        fn input_account(&self) -> &Account<'info, TokenAccount> {
                            self.action.input_account()
                        }
                        fn output_account(&self) -> &Account<'info, TokenAccount> {
                            self.action.output_account()
                        }
                    }

                    impl<'info> crate::processor::Processor<'info> for ActionContext<'_, '_, '_, 'info, #action_name<'info>> {
                        fn process_unchecked(
                            &self,
                            amount_in: u64,
                            minimum_amount_out: u64
                        ) -> Result<()> {
                            ProcessAction::process(self, amount_in, minimum_amount_out)
                        }
                    }
                },
            };

            ast.ident = action_name.clone();

            return quote! {
                // cannot use this because anchor IDL can't see this
                // #[derive(Accounts)]
                #ast

                // cannot use this because anchor IDL can't see this
                // #[derive(Accounts)]
                // pub struct #accounts_name<'info> {
                //     pub continuation: ContinuationContext<'info>,
                //     pub action: #action_name<'info>,
                // }

                #process_impl

                impl<'info> crate::Action for ActionContext<'_, '_, '_, '_, #action_name<'info>> {
                    const TYPE: crate::ActionType = crate::ActionType::#action_name;
                }
            }
            .into();
        }
        _ => panic!("`add_field` has to be used with structs "),
    }
}
